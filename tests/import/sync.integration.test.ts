/**
 * Integration test for the sync engine against the local Postgres (docker compose) with a fake broker adapter.
 * Skipped automatically when no database is reachable. Uses its own throw-away account.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildManualTrade } from "@/lib/import/manual";
import { loadSymbols, persistTrades, refreshDailySummary } from "@/lib/import/persist";
import { syncAccountStep } from "@/lib/import/sync";
import type { ImportAdapter, RawDeal } from "@/lib/import/types";

const NAME = "TEST sync account (vitest)";
let reachable = false;

const d = (p: Partial<RawDeal> & Pick<RawDeal, "id" | "positionId" | "kind" | "entry" | "time">): RawDeal => ({
  symbol: "XAUUSD",
  volume: 0.1,
  price: 2000,
  commission: 0,
  swap: 0,
  profit: 0,
  ...p,
});

class FakeAdapter implements ImportAdapter {
  readonly id = "fake";
  deals: RawDeal[] = [];
  open: RawDeal[] = [];
  async connectionState() {
    return { state: "CONNECTED" as const };
  }
  async fetchDeals(from: Date, to: Date) {
    return this.deals.filter((x) => x.time >= from && x.time < to);
  }
  async fetchPositionDeals(id: string) {
    return this.deals.filter((x) => x.positionId === id);
  }
  async fetchOpenPositions() {
    return this.open;
  }
  async fetchAccount() {
    return { balance: 10_500, equity: 10_520, currency: "AUD" };
  }
}

const T = (s: string) => new Date(`2026-10-${s}Z`);

beforeAll(async () => {
  try {
    await db.$queryRaw`select 1`;
    reachable = true;
    await db.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await db.account.deleteMany({ where: { name: NAME } });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    // DailySummary has no FK to Account, so clear its rows explicitly
    const ids = (await db.account.findMany({ where: { name: NAME }, select: { id: true } })).map((a) => a.id);
    await db.dailySummary.deleteMany({ where: { accountId: { in: ids } } });
    await db.account.deleteMany({ where: { name: NAME } });
  }
  await db.$disconnect();
});

describe("syncAccountStep", () => {
  it("syncs history, is idempotent, preserves journal edits, and closes open trades later", async (ctx) => {
    if (!reachable) return ctx.skip();

    const fake = new FakeAdapter();
    fake.deals = [
      d({ id: "d1", positionId: "1", kind: "BUY", entry: "IN", time: T("01T07:00:00"), price: 2000, commission: -0.7, stopLoss: 1995, takeProfit: 2010 }),
      d({ id: "d2", positionId: "1", kind: "SELL", entry: "OUT", time: T("01T07:05:00"), price: 2003, profit: 30 }),
      // chained partial close: 0.3 lots, 0.1 closed on the 2nd, 0.2 on the 3rd
      d({ id: "d3", positionId: "10", kind: "SELL", entry: "IN", volume: 0.3, price: 2010, time: T("02T07:00:00"), comment: "to #11" }),
      d({ id: "d4", positionId: "10", kind: "BUY", entry: "OUT", volume: 0.1, price: 2008, profit: 20, time: T("02T07:10:00"), comment: "to #11" }),
      d({ id: "d5", positionId: "11", kind: "SELL", entry: "IN", volume: 0.2, price: 2010, time: T("02T07:00:00"), comment: "from #10" }),
      d({ id: "d6", positionId: "11", kind: "BUY", entry: "OUT", volume: 0.2, price: 2012, profit: -40, time: T("03T07:00:00"), comment: "from #10" }),
      d({ id: "d7", positionId: null, kind: "BALANCE", entry: null, symbol: null, profit: 5000, time: T("01T00:00:00") }),
    ];
    fake.open = [d({ id: "99-open", positionId: "99", kind: "BUY", entry: "IN", volume: 0.5, price: 2005, profit: 12, time: T("04T07:00:00"), openPosition: true })];

    const acc = await db.account.create({
      data: { name: NAME, platform: "MT4", currency: "AUD", startingBalance: 10_000, syncType: "AUTO_METAAPI", backfillFrom: T("01T00:00:00") },
    });
    const now = T("05T12:00:00");

    // ── first sync ──
    const r1 = await syncAccountStep(acc.id, { adapter: fake, now });
    expect(r1.status).toBe("done");
    let trades = await db.trade.findMany({ where: { accountId: acc.id }, orderBy: { openedAt: "asc" }, include: { executions: true } });
    expect(trades.map((t) => [t.brokerTicket, t.status])).toEqual([["1", "CLOSED"], ["10", "CLOSED"], ["99", "OPEN"]]);
    const chain = trades[1];
    expect(Number(chain.quantity)).toBe(0.3);
    expect(Number(chain.netPnl)).toBe(-20);
    expect(chain.executions.filter((e) => Number(e.quantity) < 0)).toHaveLength(2);
    expect(trades[0]).toMatchObject({ result: "WIN", side: "LONG" });
    expect(Number(trades[0].plannedR)).toBeCloseTo(2); // (2010-2000)/(2000-1995)
    expect(await db.balanceEvent.count({ where: { accountId: acc.id } })).toBe(1);
    const sums = await db.dailySummary.findMany({ where: { accountId: acc.id }, orderBy: { day: "asc" } });
    expect(sums.map((s) => [s.day.toISOString().slice(0, 10), Number(s.netPnl)])).toEqual([["2026-10-01", 29.3], ["2026-10-03", -20]]);
    const after = await db.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(Number(after.lastBalance)).toBe(10_500);
    expect(after.lastSyncAt).not.toBeNull();

    // ── I edit the journal, then re-sync: nothing duplicates, edits survive ──
    await db.trade.update({ where: { id: trades[0].id }, data: { rating: 4.5, reviewed: true, stopLoss: 1996 } });
    const r2 = await syncAccountStep(acc.id, { adapter: fake, now: T("05T13:00:00") });
    expect(r2.status).toBe("done");
    trades = await db.trade.findMany({ where: { accountId: acc.id }, orderBy: { openedAt: "asc" }, include: { executions: true } });
    expect(trades).toHaveLength(3);
    expect(trades[0].executions).toHaveLength(2);
    expect(Number(trades[0].rating)).toBe(4.5);
    expect(trades[0].reviewed).toBe(true);
    expect(Number(trades[0].stopLoss)).toBe(1996); // broker SL (1995) must not overwrite my edit
    expect(await db.balanceEvent.count({ where: { accountId: acc.id } })).toBe(1);

    // ── the open trade later closes ──
    fake.open = [];
    fake.deals.push(
      d({ id: "d8", positionId: "99", kind: "BUY", entry: "IN", volume: 0.5, price: 2005, time: T("04T07:00:00") }),
      d({ id: "d9", positionId: "99", kind: "SELL", entry: "OUT", volume: 0.5, price: 2007, profit: 100, time: T("05T12:30:00") }),
    );
    const r3 = await syncAccountStep(acc.id, { adapter: fake, now: T("06T00:00:00") });
    expect(r3.status).toBe("done");
    const t99 = await db.trade.findFirstOrThrow({ where: { accountId: acc.id, brokerTicket: "99" } });
    expect(t99).toMatchObject({ status: "CLOSED", id: trades[2].id });
    expect(Number(t99.netPnl)).toBe(100);
    expect(await db.trade.count({ where: { accountId: acc.id } })).toBe(3);
  });

  it("reports an error and keeps going state when the broker login is rejected", async (ctx) => {
    if (!reachable) return ctx.skip();
    const acc = await db.account.create({ data: { name: NAME, platform: "MT4", currency: "AUD", startingBalance: 0, syncType: "AUTO_METAAPI" } });
    const bad: ImportAdapter = {
      id: "bad",
      connectionState: async () => ({ state: "ERROR", message: "bad login" }),
      fetchDeals: async () => [],
      fetchPositionDeals: async () => [],
      fetchOpenPositions: async () => [],
      fetchAccount: async () => ({ balance: 0, equity: 0, currency: "AUD" }),
    };
    const r = await syncAccountStep(acc.id, { adapter: bad });
    expect(r).toMatchObject({ status: "error", message: "bad login" });
    expect((await db.account.findUniqueOrThrow({ where: { id: acc.id } })).lastSyncError).toBe("bad login");
  });

  it("saves a manual trade with derived fields, executions and a daily summary", async (ctx) => {
    if (!reachable) return ctx.skip();
    const acc = await db.account.create({ data: { name: NAME, platform: "MANUAL", currency: "AUD", startingBalance: 0, syncType: "MANUAL" } });
    const built = buildManualTrade({
      brokerTicket: "manual-test",
      symbol: "XAUUSD",
      side: "SHORT",
      executions: [
        { kind: "ENTRY", at: new Date("2026-10-07T07:00:00Z"), price: 2010, lots: 0.2, fee: 1.4 },
        { kind: "EXIT", at: new Date("2026-10-07T07:05:00Z"), price: 2008, lots: 0.1, fee: 0 },
        { kind: "EXIT", at: new Date("2026-10-07T07:15:00Z"), price: 2007, lots: 0.1, fee: 0 },
      ],
      grossPnl: 50,
      swap: 0,
      stopLoss: 2015,
      takeProfit: 2000,
      comment: null,
    });
    if ("error" in built) throw new Error(built.error);
    const r = await persistTrades({ accountId: acc.id, tz: "Asia/Hong_Kong", breakevenThreshold: 0, symbols: await loadSymbols() }, [built.trade]);
    await refreshDailySummary(acc.id, r.touchedDays, 0);

    const t = await db.trade.findFirstOrThrow({ where: { accountId: acc.id }, include: { executions: true } });
    expect(t).toMatchObject({ side: "SHORT", status: "CLOSED", result: "WIN", intraday: true });
    expect(Number(t.netPnl)).toBe(48.6);
    expect(Number(t.pips)).toBe(250); // (2010 − 2007.5) / 0.01
    expect(Number(t.tradeRisk)).toBeCloseTo(0.2 * 100 * 5 * (50 / (2.5 * 0.2 * 100)), 1); // 5 pt stop × 0.2 lots × contract × implied fx
    expect(Number(t.plannedR)).toBe(2); // (2000 − 2010) / (2010 − 2015)
    expect(t.executions).toHaveLength(3);
    const day = await db.dailySummary.findFirstOrThrow({ where: { accountId: acc.id } });
    expect(day.day.toISOString().slice(0, 10)).toBe("2026-10-07");
    expect(Number(day.netPnl)).toBe(48.6);
  });
});
