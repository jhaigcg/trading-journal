import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/types";
import { expertOrder, matchScore, validateExpert, type Expert } from "@/lib/training/match";
import { exitIn, rMultiple, rrOf, simulate, validateOrder, type Order } from "@/lib/training/sim";

const bar = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 1 });
const short: Order = { side: "SHORT", entry: 100, stopLoss: 102, takeProfit: 94 }; // risk 2, reward 6: 1:3
const long: Order = { side: "LONG", entry: 100, stopLoss: 98, takeProfit: 106 };

describe("validateOrder", () => {
  it("accepts sensible orders and explains the wrong ones", () => {
    expect(validateOrder(short)).toBeNull();
    expect(validateOrder(long)).toBeNull();
    expect(validateOrder({ ...long, stopLoss: 101 })).toContain("below the entry");
    expect(validateOrder({ ...long, takeProfit: 99 })).toContain("above the entry");
    expect(validateOrder({ ...short, stopLoss: 99 })).toContain("above the entry");
    expect(validateOrder({ ...short, takeProfit: 101 })).toContain("below the entry");
    expect(validateOrder({ ...long, entry: NaN })).toContain("must all be set");
    expect(validateOrder({ ...long, entry: 0 })).toContain("must all be set");
  });
  it("risk, reward and R", () => {
    expect(rrOf(short)).toBe(3);
    expect(rMultiple(short, 94)).toBe(3);
    expect(rMultiple(short, 102)).toBe(-1);
    expect(rMultiple(long, 101)).toBe(0.5);
    expect(rMultiple(long, 99)).toBe(-0.5);
  });
});

describe("exitIn", () => {
  it("target, stop, and the stop when one candle has both", () => {
    expect(exitIn(long, bar(0, 100, 107, 99, 105))).toEqual({ outcome: "TP", price: 106 });
    expect(exitIn(long, bar(0, 100, 101, 97, 99))).toEqual({ outcome: "SL", price: 98 });
    expect(exitIn(long, bar(0, 100, 107, 97, 99))).toEqual({ outcome: "SL", price: 98 }); // never flatter the trader
    expect(exitIn(short, bar(0, 100, 101, 93, 95))).toEqual({ outcome: "TP", price: 94 });
    expect(exitIn(long, bar(0, 100, 101, 99, 100))).toBeNull();
  });
});

describe("simulate (resting order)", () => {
  it("waits for price to reach the entry, then runs to the target", () => {
    const c = [bar(0, 95, 96, 94, 95), bar(60, 96, 99, 95, 98), bar(120, 98, 101, 98.5, 100) /* touches 100: fill */, bar(180, 100, 103, 99, 102), bar(240, 102, 107, 101, 106)];
    const r = simulate(long, c);
    expect(r).toMatchObject({ filled: true, fillT: 120, outcome: "TP", exitPrice: 106, exitT: 240 });
    expect(r.r).toBe(3);
    expect(r.mfeR).toBeCloseTo(3.5); // went to 107
    expect(r.maeR).toBeCloseTo(0.75); // the fill candle itself dipped to 98.5, 1.5 against a risk of 2
  });
  it("never filled means no trade", () => {
    const r = simulate(long, [bar(0, 90, 95, 89, 94), bar(60, 94, 97, 93, 96)]);
    expect(r).toMatchObject({ filled: false, outcome: "NO_FILL", r: null });
  });
  it("a target on the fill candle itself is not credited (it may have come before the entry)", () => {
    const r = simulate(long, [bar(0, 99, 107, 98.5, 106)]); // touches 100 on the way and reaches 106
    expect(r.outcome).toBe("TIMEOUT");
    expect(r.exitPrice).toBe(106);
  });
  it("a stop on the fill candle is taken", () => {
    const r = simulate(long, [bar(0, 101, 102, 97, 98)]);
    expect(r).toMatchObject({ filled: true, outcome: "SL", exitPrice: 98, r: -1 });
  });
  it("a short is the mirror image", () => {
    const c = [bar(0, 99, 100.5, 98, 99.5) /* touches 100 */, bar(60, 99.5, 100, 95, 96), bar(120, 96, 97, 93, 94)];
    expect(simulate(short, c)).toMatchObject({ outcome: "TP", exitPrice: 94, r: 3 });
  });
  it("closes at the last candle when nothing is hit in time", () => {
    const r = simulate(long, [bar(0, 99, 101, 99, 100), bar(60, 100, 102, 99.5, 101)]);
    expect(r).toMatchObject({ outcome: "TIMEOUT", exitPrice: 101 });
    expect(r.r).toBe(0.5);
  });
  it("stop and target in one later candle: the stop", () => {
    const r = simulate(long, [bar(0, 99, 101, 99, 100), bar(60, 100, 107, 97, 100)]);
    expect(r.outcome).toBe("SL");
  });
  it("invalid orders or no candles do nothing", () => {
    expect(simulate({ ...long, stopLoss: 101 }, [bar(0, 1, 2, 1, 2)]).filled).toBe(false);
    expect(simulate(long, []).filled).toBe(false);
  });
});

describe("simulate (market order, live)", () => {
  it("fills at once; the first candle is the fill candle and the next ones decide", () => {
    const c = [bar(0, 100, 100, 100, 100), bar(5, 100, 101, 99, 100.5), bar(10, 100.5, 107, 100, 106)];
    expect(simulate(long, c, "market")).toMatchObject({ filled: true, fillT: 0, outcome: "TP", exitT: 10, r: 3 });
  });
  it("a market order does not wait for the entry price to be touched", () => {
    expect(simulate(long, [bar(0, 150, 150, 150, 150), bar(5, 150, 151, 149, 150)], "market").filled).toBe(true);
  });
});

const expert: Expert = { side: "SHORT", entryLow: 100, entryHigh: 101, stopLoss: 103, takeProfit: 93 }; // mid 100.5, risk 2.5, reward 7.5

describe("matchScore", () => {
  it("a perfect copy scores 100", () => {
    expect(matchScore({ side: "SHORT", entry: 100.5, stopLoss: 103, takeProfit: 93 }, expert).total).toBe(100);
  });
  it("anywhere inside the entry zone is full marks for the entry", () => {
    const m = matchScore({ side: "SHORT", entry: 100, stopLoss: 103, takeProfit: 93 }, expert);
    expect(m.parts.find((p) => p.key === "entry")!.points).toBe(25);
    expect(m.parts.find((p) => p.key === "entry")!.note).toContain("Inside");
  });
  it("wrong direction scores zero and says why", () => {
    const m = matchScore({ side: "LONG", entry: 100.5, stopLoss: 98, takeProfit: 108 }, expert);
    expect(m.total).toBe(0);
    expect(m.parts[0].note).toContain("short");
  });
  it("entry outside the zone loses points in proportion to the distance, in units of the expert's risk", () => {
    const near = matchScore({ side: "SHORT", entry: 101.5, stopLoss: 103, takeProfit: 93 }, expert).parts.find((p) => p.key === "entry")!;
    const far = matchScore({ side: "SHORT", entry: 103.5, stopLoss: 105, takeProfit: 93 }, expert).parts.find((p) => p.key === "entry")!;
    expect(near.points).toBe(Math.round(25 * (1 - 0.5 / 2.5)));
    expect(far.points).toBe(0); // a full expert risk (or more) outside
  });
  it("a tighter stop is called out as likely to be swept; a wider one as risking more", () => {
    const tight = matchScore({ side: "SHORT", entry: 100.5, stopLoss: 102, takeProfit: 93 }, expert).parts.find((p) => p.key === "stop")!;
    expect(tight.points).toBeLessThan(20);
    expect(tight.note).toContain("swept");
    const wide = matchScore({ side: "SHORT", entry: 100.5, stopLoss: 104, takeProfit: 93 }, expert).parts.find((p) => p.key === "stop")!;
    expect(wide.note).toContain("Wider");
  });
  it("a target that stops short is called out", () => {
    const short1 = matchScore({ side: "SHORT", entry: 100.5, stopLoss: 103, takeProfit: 97 }, expert).parts.find((p) => p.key === "target")!;
    expect(short1.note).toContain("Short of");
    expect(short1.points).toBeLessThan(15);
  });
  it("the total is the sum of the parts, between 0 and 100", () => {
    for (const u of [{ entry: 99, stopLoss: 104, takeProfit: 90 }, { entry: 101, stopLoss: 102, takeProfit: 99 }, { entry: 120, stopLoss: 130, takeProfit: 50 }]) {
      const m = matchScore({ side: "SHORT", ...u }, expert);
      expect(m.total).toBe(m.parts.reduce((s, p) => s + p.points, 0));
      expect(m.total).toBeGreaterThanOrEqual(0);
      expect(m.total).toBeLessThanOrEqual(100);
    }
  });
  it("the expert's order and its validation", () => {
    expect(expertOrder(expert)).toEqual({ side: "SHORT", entry: 100.5, stopLoss: 103, takeProfit: 93 });
    expect(validateExpert(expert)).toBeNull();
    expect(validateExpert({ ...expert, stopLoss: 100.5 })).toContain("above the entry zone");
    expect(validateExpert({ ...expert, takeProfit: 100.5 })).toContain("below the entry zone");
    expect(validateExpert({ ...expert, side: "LONG", stopLoss: 98, takeProfit: 90 })).toContain("above the entry zone");
    expect(validateExpert({ ...expert, entryLow: NaN })).toContain("Set the entry zone");
  });
});
