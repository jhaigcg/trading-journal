import { randomBytes } from "node:crypto";
import type { AccountSnapshot, ConnectionState, DealKind, EntryKind, ImportAdapter, RawDeal } from "./types";

/**
 * MetaApi (metaapi.cloud) gateway. MT4 has no public API, so MetaApi connects to the broker with the
 * read-only INVESTOR password and exposes history over REST. The password is sent to MetaApi once, at
 * provisioning time, and is never stored by this app.
 */

const PROVISIONING = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const clientHost = (region: string) => `https://mt-client-api-v1.${region}.agiliumtrade.ai`;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const metaapiConfigured = () => !!process.env.METAAPI_TOKEN;
const defaultRegion = () => process.env.METAAPI_REGION || "new-york";

function token() {
  const t = process.env.METAAPI_TOKEN;
  if (!t) throw new MetaApiError("METAAPI_TOKEN is not set", 500);
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(url: string, init: RequestInit & { headers?: Record<string, string> } = {}, attempt = 0): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await fetch(url, {
    ...init,
    headers: { "auth-token": token(), "content-type": "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if ((res.status === 429 || res.status === 503) && attempt < 3) {
    await sleep(1500 * (attempt + 1));
    return call<T>(url, init, attempt + 1);
  }
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok && res.status !== 202) {
    const msg = (body as { message?: string })?.message ?? `MetaApi request failed (${res.status})`;
    throw new MetaApiError(msg, res.status, body);
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

// ───────────── provisioning ─────────────

export interface ProvisionedAccount {
  _id?: string;
  id?: string;
  state: "CREATED" | "DEPLOYING" | "DEPLOYED" | "UNDEPLOYING" | "UNDEPLOYED" | "DELETING" | "DRAFT";
  connectionStatus?: "CONNECTED" | "DISCONNECTED" | "DISCONNECTED_FROM_BROKER";
  region?: string;
  login?: string;
  server?: string;
}

export async function provisionAccount(p: {
  name: string;
  login: string;
  investorPassword: string;
  server: string;
  platform?: "mt4" | "mt5";
  brokerKeywords?: string[];
}): Promise<{ id: string; state: string }> {
  const transactionId = randomBytes(16).toString("hex");
  const body = JSON.stringify({
    name: p.name,
    login: p.login,
    password: p.investorPassword,
    server: p.server,
    platform: p.platform ?? "mt4",
    magic: 0,
    type: "cloud-g2",
    keywords: p.brokerKeywords,
    metastatsApiEnabled: false,
  });
  for (let i = 0; i < 6; i++) {
    const r = await call<{ id: string; state: string }>(`${PROVISIONING}/users/current/accounts`, {
      method: "POST",
      body,
      headers: { "transaction-id": transactionId },
    });
    if (r.status !== 202) return r.body;
    await sleep(Math.max(1, Number(r.headers.get("retry-after") ?? 2)) * 1000);
  }
  throw new MetaApiError("MetaApi is still processing the request; try again in a minute.", 202);
}

export async function getProvisionedAccount(id: string): Promise<ProvisionedAccount> {
  return (await call<ProvisionedAccount>(`${PROVISIONING}/users/current/accounts/${id}`)).body;
}

export async function deployAccount(id: string) {
  await call(`${PROVISIONING}/users/current/accounts/${id}/deploy`, { method: "POST" });
}

export async function removeAccount(id: string) {
  await call(`${PROVISIONING}/users/current/accounts/${id}`, { method: "DELETE" });
}

// ───────────── mapping ─────────────

const DEAL_KIND: Record<string, DealKind> = { DEAL_TYPE_BUY: "BUY", DEAL_TYPE_SELL: "SELL", DEAL_TYPE_BALANCE: "BALANCE" };
const ENTRY_KIND: Record<string, EntryKind> = { DEAL_ENTRY_IN: "IN", DEAL_ENTRY_OUT: "OUT", DEAL_ENTRY_INOUT: "INOUT", DEAL_ENTRY_OUT_BY: "OUT_BY" };

interface MetaDeal {
  id: string;
  type: string;
  entryType?: string;
  symbol?: string;
  magic?: number;
  time: string;
  volume?: number;
  price?: number;
  commission?: number;
  swap?: number;
  profit?: number;
  positionId?: string;
  comment?: string;
  stopLoss?: number;
  takeProfit?: number;
}

export function mapDeal(d: MetaDeal): RawDeal {
  const kind = DEAL_KIND[d.type] ?? "OTHER";
  return {
    id: String(d.id),
    positionId: d.positionId ? String(d.positionId) : null,
    kind,
    entry: d.entryType ? (ENTRY_KIND[d.entryType] ?? null) : null,
    symbol: d.symbol ?? null,
    time: new Date(d.time),
    volume: d.volume ?? 0,
    price: d.price ?? 0,
    commission: d.commission ?? 0,
    swap: d.swap ?? 0,
    profit: d.profit ?? 0,
    stopLoss: d.stopLoss || null,
    takeProfit: d.takeProfit || null,
    comment: d.comment ?? null,
    magic: d.magic ?? null,
  };
}

interface MetaPosition {
  id: string;
  type: string;
  symbol: string;
  magic?: number;
  time: string;
  openPrice: number;
  volume: number;
  swap?: number;
  profit?: number;
  commission?: number;
  comment?: string;
  stopLoss?: number;
  takeProfit?: number;
}

export function mapOpenPosition(p: MetaPosition): RawDeal {
  return {
    id: `${p.id}-open`,
    positionId: String(p.id),
    kind: p.type === "POSITION_TYPE_SELL" ? "SELL" : "BUY",
    entry: "IN",
    symbol: p.symbol,
    time: new Date(p.time),
    volume: p.volume,
    price: p.openPrice,
    commission: p.commission ?? 0,
    swap: p.swap ?? 0,
    profit: p.profit ?? 0,
    stopLoss: p.stopLoss || null,
    takeProfit: p.takeProfit || null,
    comment: p.comment ?? null,
    magic: p.magic ?? null,
    openPosition: true,
  };
}

// ───────────── adapter ─────────────

export class MetaApiAdapter implements ImportAdapter {
  readonly id = "metaapi";
  private region: string;

  constructor(private readonly accountId: string) {
    this.region = defaultRegion();
  }

  private url(path: string) {
    return `${clientHost(this.region)}/users/current/accounts/${this.accountId}${path}`;
  }

  async connectionState(): Promise<{ state: ConnectionState; message?: string }> {
    const acc = await getProvisionedAccount(this.accountId);
    if (acc.region) this.region = acc.region;
    if (acc.state === "UNDEPLOYED" || acc.state === "CREATED" || acc.state === "DRAFT") {
      await deployAccount(this.accountId);
      return { state: "CONNECTING", message: "Starting the connection to your broker…" };
    }
    if (acc.state !== "DEPLOYED") return { state: "CONNECTING", message: "Starting the connection to your broker…" };
    if (acc.connectionStatus === "CONNECTED") return { state: "CONNECTED" };
    if (acc.connectionStatus === "DISCONNECTED_FROM_BROKER") {
      return { state: "ERROR", message: "The broker is not accepting the login. Check the MT4 login, investor password and server name." };
    }
    return { state: "CONNECTING", message: "Connecting to your broker…" };
  }

  async fetchDeals(from: Date, to: Date): Promise<RawDeal[]> {
    const out: RawDeal[] = [];
    const LIMIT = 1000;
    for (let offset = 0; ; offset += LIMIT) {
      const { body } = await call<MetaDeal[] | { deals?: MetaDeal[] }>(
        this.url(`/history-deals/time/${encodeURIComponent(from.toISOString())}/${encodeURIComponent(to.toISOString())}?offset=${offset}&limit=${LIMIT}`),
      );
      const page = Array.isArray(body) ? body : (body?.deals ?? []);
      out.push(...page.map(mapDeal));
      if (page.length < LIMIT) break;
    }
    return out;
  }

  async fetchPositionDeals(positionId: string): Promise<RawDeal[]> {
    const { body } = await call<MetaDeal[] | { deals?: MetaDeal[] }>(this.url(`/history-deals/position/${encodeURIComponent(positionId)}`));
    return (Array.isArray(body) ? body : (body?.deals ?? [])).map(mapDeal);
  }

  async fetchOpenPositions(): Promise<RawDeal[]> {
    const { body } = await call<MetaPosition[]>(this.url("/positions"));
    return (body ?? []).map(mapOpenPosition);
  }

  async fetchAccount(): Promise<AccountSnapshot> {
    const { body } = await call<{ balance: number; equity: number; currency: string; broker?: string; server?: string; login?: number | string }>(this.url("/account-information"));
    return { balance: body.balance, equity: body.equity, currency: body.currency, broker: body.broker, server: body.server, login: body.login != null ? String(body.login) : undefined };
  }
}
