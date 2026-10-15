import { describe, expect, it } from "vitest";
import { firstError, scenarioSchema } from "@/lib/training/validate";

const base = { title: "T", symbol: "XAUUSD", kind: "SETUP", decisionAt: "2026-10-01T03:15:00Z", timeframe: "M5", horizonMinutes: 240, lookbackHours: 24, difficulty: 2 };
const parse = (extra: Record<string, unknown>) => scenarioSchema.safeParse({ ...base, ...extra });

describe("scenario form values", () => {
  it("names the field when a price is not a number, instead of a bare NaN message", () => {
    const r = parse({ side: "LONG", entryLow: "Liquidity: 4133.00", entryHigh: "", stopLoss: "4119.19", takeProfit: "4157.98" });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstError(r.error)).toBe("Entry zone: bottom must be a number, like 4133.00.");
  });
  it("one entry price is enough: it is used for both ends of the zone", () => {
    const low = parse({ side: "LONG", entryLow: "4133", entryHigh: "", stopLoss: "4119.19", takeProfit: "4157.98" });
    expect(low.success && [low.data.entryLow, low.data.entryHigh]).toEqual([4133, 4133]);
    const high = parse({ side: "LONG", entryLow: "", entryHigh: "4133", stopLoss: "4119.19", takeProfit: "4157.98" });
    expect(high.success && [high.data.entryLow, high.data.entryHigh]).toEqual([4133, 4133]);
  });
  it("a real zone is left alone", () => {
    const r = parse({ side: "SHORT", entryLow: "4168.5", entryHigh: "4170", stopLoss: "4173.79", takeProfit: "4125.02" });
    expect(r.success && [r.data.entryLow, r.data.entryHigh]).toEqual([4168.5, 4170]);
  });
  it("still asks for the whole answer or none of it", () => {
    const r = parse({ side: "LONG", entryLow: "4133" });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstError(r.error)).toMatch(/whole expert answer/);
  });
  it("still checks the answer makes sense (stop below entry for a long)", () => {
    const r = parse({ side: "LONG", entryLow: "4133", entryHigh: "4135", stopLoss: "4150", takeProfit: "4157.98" });
    expect(r.success).toBe(false);
  });
  it("no answer at all is fine", () => {
    expect(parse({}).success).toBe(true);
  });
});
