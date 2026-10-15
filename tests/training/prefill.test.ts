import { describe, expect, it } from "vitest";
import { parsePrefill, prefillQuery, type Prefill } from "@/lib/training/prefill";

const full: Prefill = {
  title: "Short: sweep of 4,170",
  kind: "SETUP",
  at: "2026-10-14T03:15:00.000Z",
  timeframe: "M5",
  horizon: 600,
  lookback: 24,
  side: "SHORT",
  entryLow: 4168.5,
  entryHigh: 4170,
  stopLoss: 4173.79,
  takeProfit: 4125.02,
  notes: "Sweep, then drop & target the lows.",
  difficulty: 2,
};

describe("scenario prefill links", () => {
  it("round-trips every field through a link, including awkward characters", () => {
    expect(parsePrefill(Object.fromEntries(new URLSearchParams(prefillQuery(full))))).toEqual(full);
  });
  it("accepts a time with an offset and converts it to UTC", () => {
    expect(parsePrefill({ at: "2026-10-14T11:15:00+08:00" }).at).toBe("2026-10-14T03:15:00.000Z");
  });
  it("ignores values that do not look right instead of failing", () => {
    const p = parsePrefill({ kind: "WEIRD", at: "not a date", side: "UP", entryLow: "abc", stopLoss: "-5", takeProfit: "0", horizon: "9999", lookback: "0", difficulty: "7", timeframe: "M3" });
    expect(p).toEqual({});
  });
  it("only allows timeframes that suit the kind of scenario", () => {
    expect(parsePrefill({ kind: "EVENT", timeframe: "S5" }).timeframe).toBe("S5");
    expect(parsePrefill({ kind: "SETUP", timeframe: "S5" }).timeframe).toBeUndefined();
    expect(parsePrefill({ kind: "SETUP", timeframe: "M15" }).timeframe).toBe("M15");
  });
  it("trims and caps text, and ignores blanks", () => {
    expect(parsePrefill({ title: "  hi  ", notes: "" })).toEqual({ title: "hi" });
    expect(parsePrefill({ title: "x".repeat(500) }).title).toHaveLength(120);
    expect(parsePrefill({ notes: "y".repeat(9000) }).notes).toHaveLength(4000);
  });
  it("takes the first value when a parameter is repeated, and nothing when there are none", () => {
    expect(parsePrefill({ side: ["LONG", "SHORT"] }).side).toBe("LONG");
    expect(parsePrefill({})).toEqual({});
  });
  it("treats markup in text as plain text (it is only ever put into form fields)", () => {
    expect(parsePrefill({ title: "<img src=x onerror=alert(1)>" }).title).toBe("<img src=x onerror=alert(1)>");
  });
});
