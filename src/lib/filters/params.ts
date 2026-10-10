/**
 * Global filter state. Everything lives in the URL query string so views are shareable and refresh-safe.
 * Parsing is a strict whitelist: unknown or malformed values are dropped, never passed to SQL.
 */

export const INSTRUMENTS = ["FOREX_CFD", "FUTURES", "STOCK"] as const;
export const SESSIONS = ["asia", "london", "newyork"] as const;
export const FLAGS = ["noStopLoss", "noTarget", "noStrategy", "untagged", "unreviewed", "hasMistake"] as const;
export const RESULTS = ["WIN", "LOSS", "BREAKEVEN"] as const;

export type Instrument = (typeof INSTRUMENTS)[number];
export type Session = (typeof SESSIONS)[number];
export type Flag = (typeof FLAGS)[number];

/** Trading sessions by UTC hour of the trade's open (start inclusive, end exclusive). */
export const SESSION_HOURS: Record<Session, [number, number]> = { asia: [0, 7], london: [7, 13], newyork: [13, 21] };

export const FLAG_LABELS: Record<Flag, string> = {
  noStopLoss: "No stop loss",
  noTarget: "No profit target",
  noStrategy: "No strategy linked",
  untagged: "No tags",
  unreviewed: "Not reviewed",
  hasMistake: "Tagged with a mistake",
};

export interface Filters {
  account?: string;
  range: string; // preset key, see resolveRange
  from?: string;
  to?: string;
  ccy?: string;
  // General
  instrument?: Instrument;
  duration?: "intraday" | "multiday";
  status: "closed" | "open" | "all";
  reviewed?: "yes" | "no";
  side?: "LONG" | "SHORT";
  symbol?: string;
  result?: (typeof RESULTS)[number];
  // Tags / Strategy
  tags: string[];
  strategy: string[]; // strategy ids, or "none"
  // Day & Time (display timezone for dow/hour, UTC for session)
  dow: number[]; // 0 = Sunday … 6 = Saturday
  hour: number[]; // 0–23
  session: Session[];
  // Insights
  flags: Flag[];
}

type Raw = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const csv = (v: string | string[] | undefined) =>
  (one(v) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
const ints = (v: string | string[] | undefined, min: number, max: number) => [...new Set(csv(v).map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b);

export function parseFilters(raw: Raw): Filters {
  const symbol = one(raw.symbol)?.trim().toUpperCase();
  const from = one(raw.from);
  const to = one(raw.to);
  return {
    account: ID.test(one(raw.account) ?? "") ? one(raw.account) : undefined,
    range: one(raw.range) && /^[a-z0-9]{2,10}$/.test(one(raw.range)!) ? one(raw.range)! : "month",
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    ccy: /^[A-Z]{3}$/.test(one(raw.ccy) ?? "") ? one(raw.ccy) : undefined,
    instrument: pick(one(raw.instrument), INSTRUMENTS),
    duration: pick(one(raw.duration), ["intraday", "multiday"] as const),
    status: pick(one(raw.status), ["closed", "open", "all"] as const) ?? "closed",
    reviewed: pick(one(raw.reviewed), ["yes", "no"] as const),
    side: pick(one(raw.side), ["LONG", "SHORT"] as const),
    symbol: symbol && /^[A-Z0-9._#-]{2,20}$/.test(symbol) ? symbol : undefined,
    result: pick(one(raw.result), RESULTS),
    tags: csv(raw.tags).filter((t) => ID.test(t)).slice(0, 50),
    strategy: csv(raw.strategy).filter((t) => t === "none" || ID.test(t)).slice(0, 50),
    dow: ints(raw.dow, 0, 6),
    hour: ints(raw.hour, 0, 23),
    session: csv(raw.session).filter((s): s is Session => (SESSIONS as readonly string[]).includes(s)),
    flags: csv(raw.flags).filter((s): s is Flag => (FLAGS as readonly string[]).includes(s)),
  };
}

/** The advanced (non-global) keys, i.e. everything the "Filters" panel owns. */
export const ADVANCED_KEYS = ["instrument", "duration", "status", "reviewed", "side", "symbol", "result", "tags", "strategy", "dow", "hour", "session", "flags"] as const;

export function activeAdvancedCount(f: Filters): number {
  let n = 0;
  if (f.instrument) n++;
  if (f.duration) n++;
  if (f.status !== "closed") n++;
  if (f.reviewed) n++;
  if (f.side) n++;
  if (f.symbol) n++;
  if (f.result) n++;
  if (f.tags.length) n++;
  if (f.strategy.length) n++;
  if (f.dow.length) n++;
  if (f.hour.length) n++;
  if (f.session.length) n++;
  if (f.flags.length) n++;
  return n;
}

/** Serialise advanced filters back to query params (omitting defaults). */
export function advancedToParams(f: Partial<Filters>): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.instrument) out.instrument = f.instrument;
  if (f.duration) out.duration = f.duration;
  if (f.status && f.status !== "closed") out.status = f.status;
  if (f.reviewed) out.reviewed = f.reviewed;
  if (f.side) out.side = f.side;
  if (f.symbol) out.symbol = f.symbol;
  if (f.result) out.result = f.result;
  if (f.tags?.length) out.tags = f.tags.join(",");
  if (f.strategy?.length) out.strategy = f.strategy.join(",");
  if (f.dow?.length) out.dow = f.dow.join(",");
  if (f.hour?.length) out.hour = f.hour.join(",");
  if (f.session?.length) out.session = f.session.join(",");
  if (f.flags?.length) out.flags = f.flags.join(",");
  return out;
}
