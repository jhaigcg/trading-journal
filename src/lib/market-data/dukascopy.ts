import * as LZMA from "lzma";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { Candle, MarketDataProvider, NativeTimeframe } from "./types";
import { periodRange } from "./periods";

/**
 * Dukascopy's public historical datafeed (bid candles). Files are LZMA-compressed arrays of 24-byte
 * big-endian records: seconds since the file's start (u32), open, close, low, high (u32, scaled by the
 * instrument's point value) and volume (f32). Their servers throttle unknown clients, so requests send a
 * browser User-Agent, retry with backoff, and are issued one at a time by the cache layer.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const BASE = "https://datafeed.dukascopy.com/datafeed";

interface Instrument {
  code: string;
  /** price = raw / scale */
  scale: number;
}

const KNOWN: Record<string, Instrument> = {
  XAUUSD: { code: "XAUUSD", scale: 1000 },
  XAGUSD: { code: "XAGUSD", scale: 1000 },
  USDJPY: { code: "USDJPY", scale: 1000 },
  EURJPY: { code: "EURJPY", scale: 1000 },
  GBPJPY: { code: "GBPJPY", scale: 1000 },
  AUDJPY: { code: "AUDJPY", scale: 1000 },
};

const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "SGD", "HKD", "NOK", "SEK", "DKK", "PLN", "TRY", "ZAR", "MXN", "CZK", "HUF"]);

/** Dukascopy code + price scale for a symbol, or null when we have no feed for it (e.g. cotton futures). */
export function instrumentFor(symbol: string): Instrument | null {
  const s = symbol.toUpperCase();
  if (KNOWN[s]) return KNOWN[s];
  // standard FX pairs: both halves must be real currency codes (so a six-letter commodity is not mistaken for one)
  if (/^[A-Z]{6}$/.test(s) && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3))) return { code: s, scale: s.endsWith("JPY") ? 1000 : 100_000 };
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Some networks (and dev machines) can only reach the internet through a proxy; honour the standard variable explicitly.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const proxyAgent = PROXY ? new ProxyAgent(PROXY) : undefined;

async function get(url: string): Promise<{ status: number; body: Buffer }> {
  const init = { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(20_000) };
  const res = proxyAgent ? await undiciFetch(url, { ...init, dispatcher: proxyAgent }) : await fetch(url, { ...init, cache: "no-store" });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

/**
 * GET a .bi5 file. Returns null for 404 (no data for that period, e.g. weekends).
 * The datafeed answers 429/503 intermittently, so failures are retried with jittered exponential backoff
 * (about 40 s in total) before giving up.
 */
export async function fetchBi5(url: string, retries = 7): Promise<Buffer | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { status, body } = await get(url);
      if (status === 404) return null;
      if (status === 200) return body;
      lastErr = new Error(`Dukascopy responded ${status}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) await sleep(Math.min(700 * 1.7 ** attempt, 8000) * (0.75 + Math.random() * 0.5));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Dukascopy request failed");
}

export function lzmaDecode(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    LZMA.decompress(Array.from(buf), (res, err) => {
      if (err || !res || typeof res === "string") return reject(err ?? new Error("LZMA decode failed"));
      resolve(Buffer.from(res.map((b) => b & 255)));
    });
  });
}

/** Parse decoded candle records. `baseSec` is the unix time the record offsets count from. */
export function parseCandles(raw: Buffer, baseSec: number, scale: number): Candle[] {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
  const out: Candle[] = [];
  for (let o = 0; o + 24 <= raw.length; o += 24) {
    out.push({
      t: baseSec + dv.getUint32(o),
      o: dv.getUint32(o + 4) / scale,
      c: dv.getUint32(o + 8) / scale,
      l: dv.getUint32(o + 12) / scale,
      h: dv.getUint32(o + 16) / scale,
      v: dv.getFloat32(o + 20),
    });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Datafeed URL for a period. Dukascopy months are zero-based. */
export function periodUrl(code: string, native: NativeTimeframe, period: string): string {
  const [y, m, d] = period.split("-").map(Number);
  if (native === "M1") return `${BASE}/${code}/${y}/${pad(m - 1)}/${pad(d)}/BID_candles_min_1.bi5`;
  return `${BASE}/${code}/${y}/${pad(m - 1)}/BID_candles_hour_1.bi5`;
}

export const dukascopy: MarketDataProvider = {
  id: "dukascopy",
  supports: (symbol) => instrumentFor(symbol) != null,
  async fetchPeriod(symbol, native, period) {
    const inst = instrumentFor(symbol);
    if (!inst) return [];
    const buf = await fetchBi5(periodUrl(inst.code, native, period));
    if (!buf || buf.length === 0) return [];
    const [start] = periodRange(native, period);
    return parseCandles(await lzmaDecode(buf), start, inst.scale).sort((a, b) => a.t - b.t);
  },
};
