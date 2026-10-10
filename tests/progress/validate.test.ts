import { describe, expect, it } from "vitest";
import { STARTER_RULES, parseRuleInput, parseWeekdays } from "@/lib/progress/validate";

describe("parseRuleInput", () => {
  it("accepts each kind and stores only its own parameters", () => {
    expect(parseRuleInput({ name: " Start ", kind: "TIME_BY", time: "9:30" })).toEqual({ ok: true, value: { name: "Start", kind: "TIME_BY", params: { time: "09:30" } } });
    expect(parseRuleInput({ name: "SL", kind: "PERCENT_WITH_FIELD", field: "stopLoss", percent: "90", junk: 1 })).toEqual({ ok: true, value: { name: "SL", kind: "PERCENT_WITH_FIELD", params: { field: "stopLoss", percent: 90 } } });
    expect(parseRuleInput({ name: "Cap", kind: "MAX_LOSS_PER_DAY", amount: "150.5" })).toEqual({ ok: true, value: { name: "Cap", kind: "MAX_LOSS_PER_DAY", params: { amount: 150.5 } } });
    expect(parseRuleInput({ name: "Cap", kind: "MAX_LOSS_PER_TRADE", amount: 20 }).ok).toBe(true);
    expect(parseRuleInput({ name: "Plan", kind: "MANUAL_CHECK" })).toEqual({ ok: true, value: { name: "Plan", kind: "MANUAL_CHECK", params: {} } });
  });
  it("explains what is wrong in plain words", () => {
    const err = (x: unknown) => { const r = parseRuleInput(x); return r.ok ? "" : r.error; };
    expect(err({ name: "", kind: "MANUAL_CHECK" })).toBe("Give the rule a name.");
    expect(err({ name: "a", kind: "TIME_BY", time: "25:00" })).toBe("Use a time like 09:30.");
    expect(err({ name: "a", kind: "MAX_LOSS_PER_DAY", amount: 0 })).toBe("Enter an amount above 0.");
    expect(err({ name: "a", kind: "MAX_LOSS_PER_DAY", amount: "abc" })).not.toBe("");
    expect(err({ name: "a", kind: "PERCENT_WITH_FIELD", field: "stopLoss", percent: 101 })).toBe("Use 1 to 100.");
    expect(err({ name: "a", kind: "PERCENT_WITH_FIELD", field: "bogus", percent: 100 })).not.toBe("");
    expect(err({ name: "a", kind: "NOPE" })).not.toBe("");
    expect(err(null)).not.toBe("");
  });
  it("the starter rules are all valid as stored", () => {
    for (const r of STARTER_RULES) expect(parseRuleInput({ name: r.name, kind: r.kind, ...r.params }).ok).toBe(true);
  });
});

describe("parseWeekdays", () => {
  it("accepts 0..6 without repeats, sorted", () => {
    expect(parseWeekdays([5, 1, 3])).toEqual([1, 3, 5]);
    expect(parseWeekdays([0, 6])).toEqual([0, 6]);
  });
  it("rejects empty, out of range and repeated", () => {
    expect(parseWeekdays([])).toBeNull();
    expect(parseWeekdays([7])).toBeNull();
    expect(parseWeekdays([1, 1])).toBeNull();
    expect(parseWeekdays("1")).toBeNull();
  });
});
