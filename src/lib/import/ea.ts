import { createHash, randomBytes } from "node:crypto";
import { Prisma, type Account, type BrokerOrder } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { brokerEpochToUtc, DEFAULT_TZ, isValidBrokerTimeMode } from "@/lib/time";
import { loadSymbols, persistBalanceEvents, persistTrades, refreshDailySummary } from "./persist";
import { buildTrades, type BalanceEventRaw } from "./position-builder";
import type { RawDeal } from "./types";

/**
 * Receives MT4 orders pushed by the LedgerSync Expert Advisor.
 *
 * Orders are stored raw (BrokerOrder) and trades are rebuilt from the stored rows, so a partial-close
 * chain (ticket A → B) merges correctly no matter which request each half arrives in, and every
 * request is idempotent.
 */

// ───────────── tokens ─────────────

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new secret for an EA connection. Shown to the user once; only its hash is stored. */
export const newIngestToken = () => `lj_${randomBytes(32).toString("base64url")}`;

// ───────────── payload ─────────────

const num = z.number().finite();
const order = z.object({
  t: z.union([z.string(), z.number()]).transform(String),
  ty: z.number().int(), // 0 buy · 1 sell · 6 balance · 7 credit · others (pending) are ignored
  ot: num, // open time, MT4 server clock (seconds)
  ct: num.default(0), // close time, 0 while open
  op: num.default(0),
  cp: num.default(0),
  l: num.default(0),
  s: z.string().max(40).default(""),
  p: num.default(0),
  sw: num.default(0),
  cm: num.default(0),
  sl: num.default(0),
  tp: num.default(0),
  c: z.string().max(200).default(""),
  m: z.number().int().default(0),
});

export const payloadSchema = z.object({
  v: z.number().int().default(1),
  login: z.union([z.string(), z.number()]).transform(String),
  server: z.string().max(100).optional(),
  company: z.string().max(100).optional(),
  currency: z.string().max(8).optional(),
  balance: num.optional(),
  equity: num.optional(),
  offsetSec: num.nullable().optional(),
  orders: z.array(order).max(500).default([]),
  /** snapshot of currently open positions; omitted on history-only batches */
  open: z.array(order).max(300).optional(),
});

export type EaPayload = z.infer<typeof payloadSchema>;
type EaOrder = z.infer<typeof order>;

const REF_RE = /(?:from|to)\s*#\s*(\d+)/i;
const isTrade = (o: EaOrder) => o.ty === 0 || o.ty === 1;
const isBalanceOp = (o: EaOrder) => (o.ty === 6 || o.ty === 7) && o.p !== 0;

/** Stored order → the broker-agnostic deals the position builder understands (same ticket namespace as MetaApi). */
export function orderToDeals(o: BrokerOrder): RawDeal[] {
  if (o.type > 1) return []; // deposits / withdrawals are not trades
  const kind = o.type === 0 ? "BUY" : "SELL";
  const common = { positionId: o.ticket, symbol: o.symbol, volume: Number(o.lots), comment: o.comment, magic: o.magic, stopLoss: o.stopLoss == null ? null : Number(o.stopLoss), takeProfit: o.takeProfit == null ? null : Number(o.takeProfit) } as const;
  if (o.isOpen || !o.closeTime) {
    return [{ ...common, id: `${o.ticket}-open`, kind, entry: "IN", time: o.openTime, price: Number(o.openPrice), commission: Number(o.commission), swap: Number(o.swap), profit: Number(o.profit), openPosition: true }];
  }
  return [
    { ...common, id: `${o.ticket}-in`, kind, entry: "IN", time: o.openTime, price: Number(o.openPrice), commission: 0, swap: 0, profit: 0 },
    { ...common, id: `${o.ticket}-out`, kind: kind === "BUY" ? "SELL" : "BUY", entry: "OUT", time: o.closeTime, price: Number(o.closePrice ?? o.openPrice), commission: Number(o.commission), swap: Number(o.swap), profit: Number(o.profit) },
  ];
}

const dec = (n: number | null | undefined) => (n == null ? null : new Prisma.Decimal(n));

function toRow(accountId: string, mode: string, o: EaOrder, isOpen: boolean) {
  return {
    accountId,
    ticket: o.t,
    type: o.ty,
    isOpen,
    openRaw: o.ot,
    closeRaw: isOpen || !o.ct ? null : o.ct,
    openTime: brokerEpochToUtc(o.ot, mode),
    closeTime: isOpen || !o.ct ? null : brokerEpochToUtc(o.ct, mode),
    openPrice: o.op,
    closePrice: isOpen || !o.ct ? null : o.cp,
    lots: o.l,
    symbol: o.s,
    profit: o.p,
    swap: o.sw,
    commission: o.cm,
    stopLoss: o.sl || null,
    takeProfit: o.tp || null,
    comment: o.c || null,
    refTicket: o.c.match(REF_RE)?.[1] ?? null,
    magic: o.m || null,
  };
}

export interface IngestResult {
  orders: number;
  trades: number;
  removed: number;
}

export async function ingestEaPayload(account: Account, p: EaPayload): Promise<IngestResult> {
  const mode = account.brokerTimeMode;
  const closed = p.orders.filter(isTrade).filter((o) => o.ct > 0);
  const openFromOrders = p.orders.filter(isTrade).filter((o) => o.ct === 0);
  const openList = [...(p.open ?? []).filter(isTrade), ...openFromOrders];

  // 1. store raw orders (new → insert, known → update)
  const balanceRecords = p.orders.filter(isBalanceOp);
  const rows = [
    ...closed.map((o) => toRow(account.id, mode, o, false)),
    ...openList.map((o) => toRow(account.id, mode, o, true)),
    // deposits/withdrawals are kept raw as well so their dates follow the broker-time setting
    ...balanceRecords.map((o) => toRow(account.id, mode, { ...o, ct: o.ot }, false)),
  ];
  // a closed record always wins over an open one for the same ticket
  const byTicket = new Map(rows.map((r) => [r.ticket, r]));
  for (const r of rows) if (!r.isOpen) byTicket.set(r.ticket, r);
  const unique = [...byTicket.values()];

  if (unique.length) {
    const known = new Set((await db.brokerOrder.findMany({ where: { accountId: account.id, ticket: { in: unique.map((r) => r.ticket) } }, select: { ticket: true } })).map((r) => r.ticket));
    const fresh = unique.filter((r) => !known.has(r.ticket));
    for (let i = 0; i < fresh.length; i += 200) await db.brokerOrder.createMany({ data: fresh.slice(i, i + 200), skipDuplicates: true });
    const existing = unique.filter((r) => known.has(r.ticket));
    for (let i = 0; i < existing.length; i += 50) {
      await db.$transaction(
        existing.slice(i, i + 50).map((r) => {
          const { accountId, ticket, ...data } = r;
          return db.brokerOrder.update({ where: { accountId_ticket: { accountId, ticket } }, data });
        }),
      );
    }
  }

  // 2. expand to every order linked to these by "from #/to #" comments (in either direction)
  const touched = new Set(unique.map((r) => r.ticket));
  let closure = new Set(touched);
  let stored: BrokerOrder[] = [];
  for (let round = 0; round < 6 && closure.size && closure.size <= 3000; round++) {
    const ids = [...closure];
    stored = await db.brokerOrder.findMany({ where: { accountId: account.id, OR: [{ ticket: { in: ids } }, { refTicket: { in: ids } }] } });
    const next = new Set(ids);
    for (const o of stored) {
      next.add(o.ticket);
      if (o.refTicket) next.add(o.refTicket);
    }
    if (next.size === closure.size) break;
    closure = next;
  }

  // 3. rebuild and persist trades for the affected chains
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  const ctx = { accountId: account.id, tz: settings?.displayTimezone ?? DEFAULT_TZ, breakevenThreshold: Number(settings?.breakevenThreshold ?? 0), symbols: await loadSymbols() };
  const built = buildTrades(stored.flatMap(orderToDeals));
  const saved = await persistTrades(ctx, built.trades);

  // a half-chain saved earlier as its own trade is superseded once the whole chain is known
  const keep = new Set(built.trades.map((t) => t.brokerTicket));
  const staleCandidates = [...closure].filter((t) => !keep.has(t));
  const stale = staleCandidates.length
    ? await db.trade.findMany({ where: { accountId: account.id, brokerTicket: { in: staleCandidates } }, select: { id: true, closeDay: true } })
    : [];
  const days = new Set(saved.touchedDays);
  if (stale.length) {
    for (const s of stale) if (s.closeDay) days.add(s.closeDay.toISOString().slice(0, 10));
    await db.trade.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
  if (days.size) await refreshDailySummary(account.id, [...days], ctx.breakevenThreshold);

  // 4. deposits / withdrawals
  const balanceOps: BalanceEventRaw[] = p.orders
    .filter(isBalanceOp)
    .map((o) => ({ brokerTicket: o.t, at: brokerEpochToUtc(o.ot, mode), amount: o.p, comment: o.c || null }));
  await persistBalanceEvents(account.id, balanceOps);

  // 5. account status
  const reportedMin = p.offsetSec != null && Math.abs(p.offsetSec) <= 14 * 3600 && p.offsetSec % 900 === 0 ? p.offsetSec / 60 : null;
  const now = new Date();
  await db.account.update({
    where: { id: account.id },
    data: {
      lastHeartbeatAt: now,
      ...(p.orders.length ? { lastSyncAt: now } : {}),
      lastSyncError: null,
      mtLogin: account.mtLogin ?? p.login,
      mtServer: p.server ?? account.mtServer,
      broker: account.broker ?? p.company ?? null,
      ...(p.currency ? { currency: p.currency } : {}),
      ...(p.balance != null ? { lastBalance: dec(p.balance) } : {}),
      ...(p.equity != null ? { lastEquity: dec(p.equity) } : {}),
      ...(reportedMin != null ? { lastReportedOffsetMin: reportedMin } : {}),
    },
  });
  if (p.orders.length) {
    await db.importBatch.create({ data: { accountId: account.id, source: "EA_PUSH", status: "DONE", tradesNew: saved.created, tradesUpd: saved.updated, finishedAt: now } });
  }

  return { orders: unique.length, trades: built.trades.length, removed: stale.length };
}

// ───────────── changing the broker-time setting ─────────────

const sqlTs = (d: Date | null) => (d ? d.toISOString().slice(0, 19).replace("T", " ") : "");

/**
 * Switch how this account's MT4 server clock maps to UTC, then re-convert every stored order and rebuild
 * all trades, deposits and daily summaries from the raw rows. Journal edits on trades are kept.
 */
export async function changeBrokerTimeMode(accountId: string, mode: string): Promise<{ trades: number }> {
  if (!isValidBrokerTimeMode(mode)) throw new Error("Unknown broker time setting");
  const account = await db.account.update({ where: { id: accountId }, data: { brokerTimeMode: mode } });

  // 1. re-convert the stored instants
  const rows = await db.brokerOrder.findMany({ where: { accountId }, select: { id: true, openRaw: true, closeRaw: true } });
  for (let i = 0; i < rows.length; i += 2000) {
    const part = rows.slice(i, i + 2000);
    const ids = part.map((r) => r.id);
    const ots = part.map((r) => sqlTs(brokerEpochToUtc(r.openRaw, mode)));
    const cts = part.map((r) => sqlTs(r.closeRaw ? brokerEpochToUtc(r.closeRaw, mode) : null));
    await db.$executeRaw`
      UPDATE "BrokerOrder" b SET "openTime" = v.ot::timestamp, "closeTime" = NULLIF(v.ct, '')::timestamp
      FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${ots}::text[]) AS ot, unnest(${cts}::text[]) AS ct) v
      WHERE b.id = v.id`;
  }

  // 2. rebuild trades
  const orders = await db.brokerOrder.findMany({ where: { accountId } });
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  const ctx = { accountId, tz: settings?.displayTimezone ?? DEFAULT_TZ, breakevenThreshold: Number(settings?.breakevenThreshold ?? 0), symbols: await loadSymbols() };
  const built = buildTrades(orders.flatMap(orderToDeals));
  for (let i = 0; i < built.trades.length; i += 400) await persistTrades(ctx, built.trades.slice(i, i + 400));
  const keep = built.trades.map((t) => t.brokerTicket);
  await db.trade.deleteMany({ where: { accountId, brokerTicket: { notIn: keep, not: { startsWith: "manual-" } } } });

  // 3. deposits / withdrawals
  const balanceRows = orders.filter((o) => o.type > 1);
  await db.balanceEvent.deleteMany({ where: { accountId, brokerTicket: { in: balanceRows.map((o) => o.ticket) } } });
  await persistBalanceEvents(accountId, balanceRows.map((o) => ({ brokerTicket: o.ticket, at: o.openTime, amount: Number(o.profit), comment: o.comment })));
  void account;

  // 4. daily summaries from scratch
  await db.dailySummary.deleteMany({ where: { accountId } });
  const days = await db.trade.findMany({ where: { accountId, status: "CLOSED" }, select: { closeDay: true }, distinct: ["closeDay"] });
  await refreshDailySummary(accountId, days.map((d) => d.closeDay!.toISOString().slice(0, 10)), ctx.breakevenThreshold);
  return { trades: built.trades.length };
}
