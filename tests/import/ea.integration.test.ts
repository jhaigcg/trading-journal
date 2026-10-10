/**
 * Integration test for the EA push path against the local Postgres. Skipped automatically if no database is reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { changeBrokerTimeMode, hashToken, ingestEaPayload, newIngestToken, payloadSchema } from "@/lib/import/ea";

const NAME = "TEST ea account (vitest)";
let reachable = false;

// MT4 sends server wall-clock seconds; NYCLOSE in January = UTC+2
const w = (iso: string) => Date.parse(`${iso}Z`) / 1000;
type O = Record<string, unknown>;
const order = (o: O) => ({ ty: 0, cp: 0, ct: 0, op: 2000, l: 0.1, s: "XAUUSD", p: 0, sw: 0, cm: 0, sl: 0, tp: 0, c: "", m: 0, ...o });
const payload = (orders: O[], extra: O = {}) => payloadSchema.parse({ login: "7777777", server: "Test-Live", company: "Test Broker", currency: "AUD", balance: 10_000, equity: 10_010, offsetSec: 7200, orders, ...extra });

let seq = 0;
// every test account has its own MT login (the database enforces one account per platform + login)
const P = (acc: { mtLogin: string | null }, orders: O[], extra: O = {}) => payload(orders, { login: acc.mtLogin, ...extra });

async function mkAccount(extra: Record<string, unknown> = {}) {
  return db.account.create({
    data: { name: NAME, mtLogin: String(7_000_000 + ++seq), platform: "MT4", currency: "AUD", startingBalance: 0, syncType: "AUTO_EA", brokerTimeMode: "NYCLOSE", ingestTokenHash: hashToken(newIngestToken()), ...extra },
  });
}

beforeAll(async () => {
  try {
    await db.$queryRaw`select 1`;
    reachable = true;
    await db.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    const ids = (await db.account.findMany({ where: { name: NAME }, select: { id: true } })).map((a) => a.id);
    await db.dailySummary.deleteMany({ where: { accountId: { in: ids } } });
    await db.account.deleteMany({ where: { name: NAME } });
  }
  await db.$disconnect();
});

describe("ingestEaPayload", () => {
  it("stores trades with correct UTC times, is idempotent, and records heartbeat/balance", async (ctx) => {
    if (!reachable) return ctx.skip();
    const acc = await mkAccount();
    const closedOrder = order({ t: "1001", ty: 0, ot: w("2026-01-15T12:00:00"), ct: w("2026-01-15T12:05:00"), op: 2000, cp: 2003, p: 30, cm: -0.7, sl: 1995, tp: 2010 });
    const dep = order({ t: "1000", ty: 6, ot: w("2026-01-10T09:00:00"), p: 5000, c: "Deposit", s: "" });

    const r1 = await ingestEaPayload(acc, P(acc, [dep, closedOrder]));
    expect(r1).toMatchObject({ orders: 2, trades: 1 }) // the trade plus the deposit record;
    const t = await db.trade.findFirstOrThrow({ where: { accountId: acc.id }, include: { executions: true } });
    expect(t).toMatchObject({ brokerTicket: "1001", side: "LONG", status: "CLOSED", result: "WIN" });
    // broker 12:00 in January (GMT+2) = 10:00 UTC
    expect(t.openedAt.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    expect(t.closedAt?.toISOString()).toBe("2026-01-15T10:05:00.000Z");
    expect(Number(t.netPnl)).toBe(29.3);
    expect(Number(t.stopLoss)).toBe(1995);
    expect(t.executions).toHaveLength(2);
    expect(await db.balanceEvent.count({ where: { accountId: acc.id } })).toBe(1);

    const a = await db.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(a).toMatchObject({ mtLogin: acc.mtLogin, mtServer: "Test-Live", broker: "Test Broker", lastReportedOffsetMin: 120 });
    expect(Number(a.lastBalance)).toBe(10_000);
    expect(a.lastHeartbeatAt).not.toBeNull();

    // the same batch again (EA restarts and re-sends history): nothing duplicates, journal edits survive
    await db.trade.update({ where: { id: t.id }, data: { rating: 4, reviewed: true } });
    await ingestEaPayload(acc, P(acc, [dep, closedOrder]));
    expect(await db.trade.count({ where: { accountId: acc.id } })).toBe(1);
    expect(await db.balanceEvent.count({ where: { accountId: acc.id } })).toBe(1);
    expect(await db.brokerOrder.count({ where: { accountId: acc.id } })).toBe(2);
    const again = await db.trade.findFirstOrThrow({ where: { accountId: acc.id } });
    expect(Number(again.rating)).toBe(4);
    expect(again.reviewed).toBe(true);
  });

  it("merges a partial-close chain whose halves arrive in separate, reversed batches", async (ctx) => {
    if (!reachable) return ctx.skip();
    const acc = await mkAccount();
    // MT4: ticket 2000 closed 0.1 lot of a 0.3 position; ticket 2001 is the 0.2 remainder
    const B = order({ t: "2001", ty: 1, l: 0.2, op: 2010, cp: 2012, p: -40, ot: w("2026-01-16T09:00:00"), ct: w("2026-01-16T11:00:00"), c: "from #2000" });
    const A = order({ t: "2000", ty: 1, l: 0.1, op: 2010, cp: 2008, p: 20, ot: w("2026-01-16T09:00:00"), ct: w("2026-01-16T09:30:00"), c: "to #2001" });

    await ingestEaPayload(acc, P(acc, [B]));
    expect((await db.trade.findMany({ where: { accountId: acc.id } })).map((t) => t.brokerTicket)).toEqual(["2001"]); // standalone for now

    const r = await ingestEaPayload(acc, P(acc, [A]));
    expect(r.removed).toBe(1); // the half-chain row is superseded
    const trades = await db.trade.findMany({ where: { accountId: acc.id }, include: { executions: true } });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ brokerTicket: "2000", side: "SHORT", status: "CLOSED" });
    expect(Number(trades[0].quantity)).toBe(0.3);
    expect(Number(trades[0].netPnl)).toBe(-20);
    expect(trades[0].executions.filter((e) => Number(e.quantity) < 0)).toHaveLength(2);
    // daily summary reflects the merged trade only
    const sums = await db.dailySummary.findMany({ where: { accountId: acc.id } });
    expect(sums).toHaveLength(1);
    expect(Number(sums[0].netPnl)).toBe(-20);
    expect(sums[0].trades).toBe(1);
  });

  it("tracks an open position and closes the same trade when its history arrives", async (ctx) => {
    if (!reachable) return ctx.skip();
    const acc = await mkAccount();
    const open = order({ t: "3000", ty: 0, l: 0.5, op: 2000, p: 12.5, sw: -1, cm: -3.5, ot: w("2026-01-19T08:00:00") });
    await ingestEaPayload(acc, P(acc, [], { open: [open] }));
    let t = await db.trade.findFirstOrThrow({ where: { accountId: acc.id } });
    expect(t).toMatchObject({ status: "OPEN", closedAt: null });
    expect(Number(t.netPnl)).toBe(8);

    const closed = order({ ...open, ct: w("2026-01-19T09:00:00"), cp: 2004, p: 200, sw: -1, cm: -3.5 });
    await ingestEaPayload(acc, P(acc, [closed], { open: [] }));
    const after = await db.trade.findMany({ where: { accountId: acc.id } });
    expect(after).toHaveLength(1);
    t = after[0];
    expect(t).toMatchObject({ id: t.id, status: "CLOSED", result: "WIN" });
    expect(Number(t.netPnl)).toBe(195.5);
  });

  it("re-converts times, trades, deposits and summaries when the broker-time setting changes", async (ctx) => {
    if (!reachable) return ctx.skip();
    const acc = await mkAccount(); // NYCLOSE: January = UTC+2
    const o = order({ t: "5001", ty: 0, ot: w("2026-01-15T23:30:00"), ct: w("2026-01-15T23:45:00"), op: 2000, cp: 2002, p: 20 });
    const dep = order({ t: "5000", ty: 6, ot: w("2026-01-15T22:00:00"), p: 1000, c: "Deposit", s: "" });
    await ingestEaPayload(acc, P(acc, [dep, o]));
    let t = await db.trade.findFirstOrThrow({ where: { accountId: acc.id } });
    expect(t.closedAt?.toISOString()).toBe("2026-01-15T21:45:00.000Z"); // 23:45 − 2h
    expect(t.closeDay?.toISOString().slice(0, 10)).toBe("2026-01-16"); // Hong Kong day (UTC+8) has already rolled over
    const tradeId = t.id;
    await db.trade.update({ where: { id: tradeId }, data: { rating: 5 } });

    await changeBrokerTimeMode(acc.id, "UTC+5");
    t = await db.trade.findFirstOrThrow({ where: { accountId: acc.id } });
    expect(t.id).toBe(tradeId); // same row, journal edits kept
    expect(Number(t.rating)).toBe(5);
    expect(t.closedAt?.toISOString()).toBe("2026-01-15T18:45:00.000Z"); // 23:45 − 5h
    const ev = await db.balanceEvent.findFirstOrThrow({ where: { accountId: acc.id } });
    expect(ev.at.toISOString()).toBe("2026-01-15T17:00:00.000Z");
    const sums = await db.dailySummary.findMany({ where: { accountId: acc.id } });
    expect(sums.map((x) => x.day.toISOString().slice(0, 10))).toEqual(["2026-01-16"]); // 18:45Z = 02:45 HKT next day
    expect((await db.account.findUniqueOrThrow({ where: { id: acc.id } })).brokerTimeMode).toBe("UTC+5");
    await expect(changeBrokerTimeMode(acc.id, "banana")).rejects.toThrow();
  });

  it("rejects malformed payloads and ignores pending-order records", async (ctx) => {
    if (!reachable) return ctx.skip();
    expect(payloadSchema.safeParse({ login: "1", orders: [{ t: "1", ty: 0, ot: "yesterday" }] }).success).toBe(false);
    expect(payloadSchema.safeParse({ orders: [] }).success).toBe(false);
    const acc = await mkAccount();
    const r = await ingestEaPayload(acc, P(acc, [order({ t: "4000", ty: 2, ot: w("2026-01-20T08:00:00"), ct: w("2026-01-20T08:30:00") })]));
    expect(r.trades).toBe(0);
    expect(await db.trade.count({ where: { accountId: acc.id } })).toBe(0);
  });
});

describe("tokens", () => {
  it("are unguessable, prefixed, and hash deterministically", () => {
    const a = newIngestToken();
    expect(a).toMatch(/^lj_[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(newIngestToken());
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
