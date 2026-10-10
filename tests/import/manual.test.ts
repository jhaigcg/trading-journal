import { describe, expect, it } from "vitest";
import { buildManualTrade, estimateGross, type ManualTradeInput } from "@/lib/import/manual";
import { localToUtc } from "@/lib/time";

const base: ManualTradeInput = {
  brokerTicket: "manual-1",
  symbol: "XAUUSD",
  side: "LONG",
  executions: [
    { kind: "ENTRY", at: new Date("2026-10-01T07:00:00Z"), price: 2000, lots: 0.2, fee: 1.4 },
    { kind: "EXIT", at: new Date("2026-10-01T07:10:00Z"), price: 2002, lots: 0.1, fee: 0 },
    { kind: "EXIT", at: new Date("2026-10-01T07:20:00Z"), price: 2005, lots: 0.1, fee: 0 },
  ],
  grossPnl: 70,
  swap: -1,
  stopLoss: 1995,
  takeProfit: 2010,
  comment: null,
};

describe("buildManualTrade", () => {
  it("builds a scaled-out closed trade", () => {
    const r = buildManualTrade(base);
    if ("error" in r) throw new Error(r.error);
    expect(r.trade).toMatchObject({ status: "CLOSED", quantity: 0.2, avgEntry: 2000, grossPnl: 70, commission: -1.4, swap: -1, netPnl: 67.6 });
    expect(r.trade.avgExit).toBeCloseTo(2003.5, 4);
    expect(r.trade.closedAt?.toISOString()).toBe("2026-10-01T07:20:00.000Z");
    expect(r.trade.executions.map((e) => e.quantity)).toEqual([0.2, -0.1, -0.1]);
    // gross P&L is booked once, on the final exit
    expect(r.trade.executions.map((e) => e.grossPnl)).toEqual([0, 0, 70]);
  });
  it("stays open until exits cover the entries", () => {
    const r = buildManualTrade({ ...base, executions: base.executions.slice(0, 2) });
    if ("error" in r) throw new Error(r.error);
    expect(r.trade.status).toBe("OPEN");
    expect(r.trade.closedAt).toBeNull();
  });
  it("rejects bad input", () => {
    expect(buildManualTrade({ ...base, executions: [] })).toEqual({ error: "Add at least one entry." });
    expect(buildManualTrade({ ...base, executions: [base.executions[0], { ...base.executions[1], lots: 0.5 }] })).toEqual({ error: "Exits are larger than entries." });
    expect(buildManualTrade({ ...base, executions: [base.executions[0], { ...base.executions[1], at: new Date("2026-10-01T06:00:00Z") }] })).toEqual({ error: "An exit is before the first entry." });
    expect(buildManualTrade({ ...base, executions: [{ ...base.executions[0], price: 0 }] })).toHaveProperty("error");
  });
});

describe("estimateGross", () => {
  it("long and short on gold (100 oz contract)", () => {
    expect(estimateGross("LONG", [{ lots: 0.1, price: 2000 }], [{ lots: 0.1, price: 2003 }], 100)).toBe(30);
    expect(estimateGross("SHORT", [{ lots: 0.1, price: 2000 }], [{ lots: 0.1, price: 2003 }], 100)).toBe(-30);
    expect(estimateGross("LONG", [{ lots: 0.1, price: 2000 }], [], 100)).toBeNull();
  });
});

describe("localToUtc", () => {
  it("converts wall-clock time in the display timezone to UTC", () => {
    expect(localToUtc("2026-10-01T15:30", "Asia/Hong_Kong").toISOString()).toBe("2026-10-01T07:30:00.000Z");
    expect(localToUtc("2026-10-01T00:00", "UTC").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(Number.isNaN(localToUtc("garbage").getTime())).toBe(true);
  });
});
