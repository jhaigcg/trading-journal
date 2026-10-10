import { describe, expect, it } from "vitest";
import { buildTrades } from "@/lib/import/position-builder";
import { normaliseSymbol } from "@/lib/import/symbols";
import type { RawDeal } from "@/lib/import/types";

let n = 0;
const deal = (p: Partial<RawDeal> & Pick<RawDeal, "positionId" | "kind" | "entry" | "time">): RawDeal => ({
  id: String(++n + 9000),
  symbol: "XAUUSD",
  volume: 0.1,
  price: 2000,
  commission: 0,
  swap: 0,
  profit: 0,
  ...p,
  time: new Date(p.time),
});

describe("buildTrades", () => {
  it("builds a simple closed long", () => {
    const { trades, needPositionIds } = buildTrades([
      deal({ positionId: "100", kind: "BUY", entry: "IN", time: new Date("2026-10-01T07:00:00Z"), price: 2000, commission: -0.7, stopLoss: 1995, takeProfit: 2010 }),
      deal({ positionId: "100", kind: "SELL", entry: "OUT", time: new Date("2026-10-01T07:05:00Z"), price: 2003, profit: 30, stopLoss: 1995, takeProfit: 2010 }),
    ]);
    expect(needPositionIds).toEqual([]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      brokerTicket: "100",
      side: "LONG",
      status: "CLOSED",
      quantity: 0.1,
      avgEntry: 2000,
      avgExit: 2003,
      grossPnl: 30,
      commission: -0.7,
      netPnl: 29.3,
      stopLoss: 1995,
      takeProfit: 2010,
    });
    expect(trades[0].closedAt?.toISOString()).toBe("2026-10-01T07:05:00.000Z");
    expect(trades[0].executions.map((e) => e.quantity)).toEqual([0.1, -0.1]);
  });

  it("builds a short", () => {
    const { trades } = buildTrades([
      deal({ positionId: "101", kind: "SELL", entry: "IN", time: new Date("2026-10-01T08:00:00Z"), price: 2010 }),
      deal({ positionId: "101", kind: "BUY", entry: "OUT", time: new Date("2026-10-01T08:10:00Z"), price: 2012, profit: -20 }),
    ]);
    expect(trades[0]).toMatchObject({ side: "SHORT", netPnl: -20, status: "CLOSED" });
  });

  it("merges an MT4 partial-close chain (A → B) into one trade with a scale-out", () => {
    const { trades, needPositionIds } = buildTrades([
      deal({ positionId: "200", kind: "BUY", entry: "IN", volume: 0.3, price: 2000, time: new Date("2026-10-02T07:00:00Z"), comment: "to #201", commission: -2.1 }),
      deal({ positionId: "200", kind: "SELL", entry: "OUT", volume: 0.1, price: 2002, profit: 20, time: new Date("2026-10-02T07:10:00Z"), comment: "to #201" }),
      deal({ positionId: "201", kind: "BUY", entry: "IN", volume: 0.2, price: 2000, time: new Date("2026-10-02T07:00:00Z"), comment: "from #200" }),
      deal({ positionId: "201", kind: "SELL", entry: "OUT", volume: 0.2, price: 2005, profit: 100, time: new Date("2026-10-02T07:30:00Z"), comment: "from #200" }),
    ]);
    expect(needPositionIds).toEqual([]);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.brokerTicket).toBe("200");
    expect(t.quantity).toBe(0.3);
    expect(t.status).toBe("CLOSED");
    expect(t.grossPnl).toBe(120);
    expect(t.avgExit).toBeCloseTo((0.1 * 2002 + 0.2 * 2005) / 0.3, 4);
    expect(t.closedAt?.toISOString()).toBe("2026-10-02T07:30:00.000Z");
    expect(t.executions.filter((e) => e.quantity < 0)).toHaveLength(2);
  });

  it("is idempotent: same deals in any order give the same trade", () => {
    const deals = [
      deal({ positionId: "300", kind: "BUY", entry: "IN", time: new Date("2026-10-03T07:00:00Z") }),
      deal({ positionId: "300", kind: "SELL", entry: "OUT", price: 2001, profit: 10, time: new Date("2026-10-03T07:01:00Z") }),
    ];
    const a = buildTrades(deals).trades;
    const b = buildTrades([...deals].reverse()).trades;
    expect(b).toEqual(a);
  });

  it("asks for missing deals when only the closing deal is present", () => {
    const { trades, needPositionIds } = buildTrades([
      deal({ positionId: "400", kind: "SELL", entry: "OUT", price: 2001, profit: 10, time: new Date("2026-10-04T07:01:00Z") }),
    ]);
    expect(trades).toHaveLength(0);
    expect(needPositionIds).toEqual(["400"]);
  });

  it("asks for a chained ticket that is outside the window", () => {
    const { needPositionIds } = buildTrades([
      deal({ positionId: "501", kind: "BUY", entry: "IN", volume: 0.2, time: new Date("2026-10-05T07:00:00Z"), comment: "from #500" }),
      deal({ positionId: "501", kind: "SELL", entry: "OUT", volume: 0.2, price: 2001, profit: 20, time: new Date("2026-10-05T07:10:00Z"), comment: "from #500" }),
    ]);
    expect(needPositionIds).toContain("500");
  });

  it("treats a live position as an open trade with floating P&L", () => {
    const { trades, needPositionIds } = buildTrades([
      deal({ positionId: "600", kind: "BUY", entry: "IN", volume: 0.5, price: 2000, profit: 12.5, swap: -1, commission: -3.5, time: new Date("2026-10-06T07:00:00Z"), openPosition: true }),
    ]);
    expect(needPositionIds).toEqual([]);
    expect(trades[0]).toMatchObject({ status: "OPEN", closedAt: null, avgExit: null, quantity: 0.5, netPnl: 8 });
  });

  it("keeps a partially closed position open while a live remainder exists", () => {
    const { trades } = buildTrades([
      deal({ positionId: "700", kind: "BUY", entry: "IN", volume: 0.3, time: new Date("2026-10-07T07:00:00Z"), comment: "to #701" }),
      deal({ positionId: "700", kind: "SELL", entry: "OUT", volume: 0.1, price: 2002, profit: 20, time: new Date("2026-10-07T07:10:00Z"), comment: "to #701" }),
      deal({ positionId: "701", kind: "BUY", entry: "IN", volume: 0.2, time: new Date("2026-10-07T07:00:00Z"), comment: "from #700", profit: 5, openPosition: true }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ status: "OPEN", quantity: 0.3, grossPnl: 25 });
  });

  it("separates balance operations and ignores zero-profit non-trade deals", () => {
    const { trades, balanceEvents } = buildTrades([
      deal({ positionId: null, kind: "BALANCE", entry: null, symbol: null, profit: 5000, comment: "Deposit", time: new Date("2026-10-01T00:00:00Z") }),
      deal({ positionId: null, kind: "OTHER", entry: null, symbol: null, profit: 0, time: new Date("2026-10-01T00:00:00Z") }),
    ]);
    expect(trades).toHaveLength(0);
    expect(balanceEvents).toHaveLength(1);
    expect(balanceEvents[0]).toMatchObject({ amount: 5000, comment: "Deposit" });
  });

  it("uses the volume-weighted average when scaling in", () => {
    // two separate tickets, same symbol, are separate trades (no chain comments)
    const { trades } = buildTrades([
      deal({ positionId: "800", kind: "BUY", entry: "IN", price: 2000, time: new Date("2026-10-08T07:00:00Z") }),
      deal({ positionId: "800", kind: "SELL", entry: "OUT", price: 2001, profit: 10, time: new Date("2026-10-08T07:05:00Z") }),
      deal({ positionId: "801", kind: "BUY", entry: "IN", price: 2002, time: new Date("2026-10-08T07:06:00Z") }),
      deal({ positionId: "801", kind: "SELL", entry: "OUT", price: 2003, profit: 10, time: new Date("2026-10-08T07:07:00Z") }),
    ]);
    expect(trades.map((t) => t.brokerTicket)).toEqual(["800", "801"]);
  });
});

describe("normaliseSymbol", () => {
  const cfg = [{ symbol: "XAUUSD", aliases: ["XAUUSD.a", "GOLD", "XAUUSDm"] }];
  it("maps aliases and strips suffixes", () => {
    expect(normaliseSymbol("GOLD", cfg)).toBe("XAUUSD");
    expect(normaliseSymbol("xauusdm", cfg)).toBe("XAUUSD");
    expect(normaliseSymbol("EURUSD.pro")).toBe("EURUSD");
    expect(normaliseSymbol("GBPUSD_i")).toBe("GBPUSD");
    expect(normaliseSymbol("USDJPY")).toBe("USDJPY");
  });
});

describe("buildTrades — MT4 order-history convention (closed part carries only the lots it closed)", () => {
  it("merges A (0.1 closed) and B (0.2 remainder) into one 0.3-lot trade", () => {
    const { trades, needPositionIds } = buildTrades([
      deal({ positionId: "900", kind: "BUY", entry: "IN", volume: 0.1, price: 2000, time: new Date("2026-10-09T07:00:00Z"), comment: "to #901" }),
      deal({ positionId: "900", kind: "SELL", entry: "OUT", volume: 0.1, price: 2002, profit: 20, time: new Date("2026-10-09T07:10:00Z"), comment: "to #901" }),
      deal({ positionId: "901", kind: "BUY", entry: "IN", volume: 0.2, price: 2000, time: new Date("2026-10-09T07:00:00Z"), comment: "from #900" }),
      deal({ positionId: "901", kind: "SELL", entry: "OUT", volume: 0.2, price: 2005, profit: 100, time: new Date("2026-10-09T07:30:00Z"), comment: "from #900" }),
    ]);
    expect(needPositionIds).toEqual([]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ brokerTicket: "900", quantity: 0.3, status: "CLOSED", grossPnl: 120 });
    // entry rows add up to the full size, exits add up to the same
    const q = trades[0].executions.map((e) => e.quantity);
    expect(q.filter((x) => x > 0).reduce((a, b) => a + b, 0)).toBeCloseTo(0.3, 6);
    expect(q.filter((x) => x < 0).reduce((a, b) => a + b, 0)).toBeCloseTo(-0.3, 6);
  });

  it("stays open while the remainder is a live position", () => {
    const { trades } = buildTrades([
      deal({ positionId: "910", kind: "BUY", entry: "IN", volume: 0.1, time: new Date("2026-10-09T07:00:00Z"), comment: "to #911" }),
      deal({ positionId: "910", kind: "SELL", entry: "OUT", volume: 0.1, price: 2002, profit: 20, time: new Date("2026-10-09T07:10:00Z"), comment: "to #911" }),
      deal({ positionId: "911", kind: "BUY", entry: "IN", volume: 0.2, time: new Date("2026-10-09T07:00:00Z"), comment: "from #910", profit: 4, openPosition: true }),
    ]);
    expect(trades[0]).toMatchObject({ quantity: 0.3, status: "OPEN", grossPnl: 24 });
  });
});
