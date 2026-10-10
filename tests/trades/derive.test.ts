import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/types";
import { deriveRisk, excursions, impliedFx, runningPnl } from "@/lib/trades/derive";

const closedLong = { side: "LONG" as const, status: "CLOSED" as const, avgEntry: 2000, avgExit: 2004, quantity: 0.2, grossPnl: 80, netPnl: 78.6, stopLoss: 1995, initialTarget: 2010 };

describe("deriveRisk", () => {
  it("risk, planned R and realized R for a closed long on gold (100 oz contract)", () => {
    const r = deriveRisk(closedLong, 100);
    expect(r.tradeRisk).toBe(100); // 5 pts × 0.2 lots × 100 × fx 1
    expect(r.plannedR).toBe(2);
    expect(r.realizedR).toBe(0.79); // 78.6 / 100
  });
  it("implied FX converts a USD-quoted instrument to the account currency", () => {
    // 4 pts × 0.2 lots × 100 oz = $80 would be 80; the broker booked 121.6 → fx 1.52
    const t = { ...closedLong, grossPnl: 121.6 };
    expect(impliedFx(t, 100)).toBeCloseTo(1.52, 6);
    expect(deriveRisk({ ...t, netPnl: 120 }, 100).tradeRisk).toBe(152); // risk scales by the same rate
  });
  it("shorts", () => {
    const r = deriveRisk({ side: "SHORT", status: "CLOSED", avgEntry: 2000, avgExit: 1996, quantity: 0.1, grossPnl: 40, netPnl: 40, stopLoss: 2004, initialTarget: 1992 }, 100);
    expect(r).toEqual({ tradeRisk: 40, plannedR: 2, realizedR: 1 });
  });
  it("no stop → no risk and no R; open trades have no realized R", () => {
    expect(deriveRisk({ ...closedLong, stopLoss: null }, 100)).toEqual({ tradeRisk: null, plannedR: null, realizedR: null });
    expect(deriveRisk({ ...closedLong, status: "OPEN", avgExit: null }, 100).realizedR).toBeNull();
  });
  it("editing the stop recalculates everything", () => {
    const wide = deriveRisk({ ...closedLong, stopLoss: 1990 }, 100);
    expect(wide.tradeRisk).toBe(200);
    expect(wide.plannedR).toBe(1);
    expect(wide.realizedR).toBe(0.39);
  });
});

const T0 = Date.UTC(2026, 8, 7, 9, 0, 0) / 1000;
const m1 = (min: number, c: number, h = c + 0.5, l = c - 0.5): Candle => ({ t: T0 + min * 60, o: c, h, l, c, v: 1 });

describe("runningPnl", () => {
  const trade = { side: "LONG" as const, avgEntry: 2000, openedAt: new Date(T0 * 1000), closedAt: new Date((T0 + 300) * 1000), grossPnl: 30 };

  it("tracks floating P&L then lands exactly on the final gross P&L", () => {
    const execs = [
      { at: trade.openedAt, quantity: 0.1, grossPnl: 0 },
      { at: trade.closedAt, quantity: -0.1, grossPnl: 30 },
    ];
    const pts = runningPnl(trade, execs, [m1(0, 2001), m1(1, 2002), m1(2, 1999), m1(3, 2002), m1(4, 2003)], 100, 1);
    expect(pts[0]).toEqual({ t: T0, pnl: 0 });
    expect(pts[1].pnl).toBe(10); // (2001-2000) × 0.1 × 100
    expect(pts[3].pnl).toBe(-10);
    expect(pts.at(-1)).toEqual({ t: T0 + 300, pnl: 30 });
  });

  it("books realised P&L from a partial exit and floats only the remainder", () => {
    const execs = [
      { at: trade.openedAt, quantity: 0.2, grossPnl: 0 },
      { at: new Date((T0 + 120) * 1000), quantity: -0.1, grossPnl: 20 }, // half closed at +2
      { at: trade.closedAt, quantity: -0.1, grossPnl: 10 },
    ];
    const pts = runningPnl({ ...trade, grossPnl: 30 }, execs, [m1(0, 2001), m1(1, 2002), m1(2, 2002), m1(3, 2001)], 100, 1);
    // after the partial exit at t+120s: realised 20 + remaining 0.1 lot × (2001-2000) × 100 = 10 → 30
    expect(pts.find((p) => p.t === T0 + 240)?.pnl).toBe(30);
    // before it: 0.2 lot × (2002-2000) × 100 = 40
    expect(pts.find((p) => p.t === T0 + 120)?.pnl).toBe(60 - 20); // candle 1 closes at t+120 when the partial has just happened
  });

  it("short positions profit when price falls", () => {
    const pts = runningPnl({ ...trade, side: "SHORT" }, [{ at: trade.openedAt, quantity: 0.1, grossPnl: 0 }, { at: trade.closedAt, quantity: -0.1, grossPnl: -30 }], [m1(0, 1999)], 100, 1);
    expect(pts[1].pnl).toBe(10);
  });

  it("open trades have no closing point", () => {
    const pts = runningPnl({ ...trade, closedAt: null }, [{ at: trade.openedAt, quantity: 0.1, grossPnl: 0 }], [m1(0, 2001), m1(1, 2002)], 100, 1);
    expect(pts).toHaveLength(3);
    expect(pts.at(-1)?.pnl).toBe(20);
  });
});

describe("excursions", () => {
  const candles = [m1(-1, 1990, 1995, 1985), m1(0, 2000, 2001, 1998), m1(1, 2003, 2006, 2000), m1(2, 2002, 2004, 1997), m1(6, 2050, 2060, 2040)];
  const opened = new Date(T0 * 1000);
  const closed = new Date((T0 + 180) * 1000);
  it("long: worst low is MAE, best high is MFE (candles outside the trade are ignored)", () => {
    expect(excursions("LONG", opened, closed, candles)).toEqual({ maePrice: 1997, mfePrice: 2006 });
  });
  it("short: mirrored", () => {
    expect(excursions("SHORT", opened, closed, candles)).toEqual({ maePrice: 2006, mfePrice: 1997 });
  });
  it("null with no candles in the window", () => {
    expect(excursions("LONG", opened, closed, [])).toBeNull();
  });
});

import { checkPrices } from "@/lib/queries/trade-chart";

describe("checkPrices (feed vs trade)", () => {
  const T = Date.UTC(2026, 8, 7, 9, 0, 0) / 1000;
  const feed = [0, 1, 2, 3].map((i): Candle => ({ t: T + i * 60, o: 4130, h: 4131, l: 4129, c: 4130, v: 1 }));
  it("matches when the entry sits inside the feed range (spread differences are tolerated)", () => {
    expect(checkPrices(feed, 4130.5, T + 60, 60).matches).toBe(true);
    expect(checkPrices(feed, 4133, T + 60, 60).matches).toBe(true); // 0.07% outside the range
  });
  it("flags a feed that disagrees with the trade", () => {
    const c = checkPrices(feed, 4003.79, T + 60, 60);
    expect(c.matches).toBe(false);
    expect(c.feedPrice).toBeCloseTo(4130, 6);
    expect(c.diffPct).toBeGreaterThan(3);
  });
  it("cannot judge without candles around entry", () => {
    expect(checkPrices([], 4000, T, 60)).toEqual({ matches: true, feedPrice: null, diffPct: null });
    expect(checkPrices(feed, 4000, T + 3600, 60).matches).toBe(true);
  });
});
