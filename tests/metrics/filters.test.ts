import { describe, expect, it } from "vitest";
import { currencyChoices, findRate } from "@/lib/fx";
import { activeAdvancedCount, advancedToParams, parseFilters } from "@/lib/filters/params";

describe("parseFilters", () => {
  it("defaults", () => {
    const f = parseFilters({});
    expect(f).toMatchObject({ range: "month", status: "closed", tags: [], strategy: [], dow: [], hour: [], session: [], flags: [] });
    expect(activeAdvancedCount(f)).toBe(0);
  });

  it("parses every advanced filter", () => {
    const f = parseFilters({
      account: "acc_1",
      range: "30d",
      ccy: "USD",
      instrument: "FOREX_CFD",
      duration: "intraday",
      status: "all",
      reviewed: "no",
      side: "SHORT",
      symbol: "xauusd",
      result: "LOSS",
      tags: "t1,t2",
      strategy: "s1,none",
      dow: "1,2,2,5",
      hour: "7,8",
      session: "london,newyork",
      flags: "noStopLoss,untagged",
    });
    expect(f).toMatchObject({
      account: "acc_1",
      ccy: "USD",
      instrument: "FOREX_CFD",
      duration: "intraday",
      status: "all",
      reviewed: "no",
      side: "SHORT",
      symbol: "XAUUSD",
      result: "LOSS",
      tags: ["t1", "t2"],
      strategy: ["s1", "none"],
      dow: [1, 2, 5],
      hour: [7, 8],
      session: ["london", "newyork"],
      flags: ["noStopLoss", "untagged"],
    });
    expect(activeAdvancedCount(f)).toBe(13);
  });

  it("drops anything outside the whitelist (nothing unvalidated reaches SQL)", () => {
    const f = parseFilters({
      account: "x'; DROP TABLE \"Trade\";--",
      range: "'; --",
      from: "yesterday",
      ccy: "usd",
      instrument: "CRYPTO",
      side: "BOTH",
      symbol: "A B",
      result: "MAYBE",
      tags: "ok,bad tag,'--",
      strategy: "none,;",
      dow: "7,-1,x,3",
      hour: "24,6",
      session: "mars,asia",
      flags: "evil,noTarget",
    });
    expect(f.account).toBeUndefined();
    expect(f.range).toBe("month");
    expect(f.from).toBeUndefined();
    expect(f.ccy).toBeUndefined();
    expect(f.instrument).toBeUndefined();
    expect(f.side).toBeUndefined();
    expect(f.symbol).toBeUndefined();
    expect(f.result).toBeUndefined();
    expect(f.tags).toEqual(["ok"]);
    expect(f.strategy).toEqual(["none"]);
    expect(f.dow).toEqual([3]);
    expect(f.hour).toEqual([6]);
    expect(f.session).toEqual(["asia"]);
    expect(f.flags).toEqual(["noTarget"]);
  });

  it("round-trips through advancedToParams", () => {
    const f = parseFilters({ side: "LONG", tags: "a,b", dow: "1,3", flags: "unreviewed", status: "open" });
    expect(parseFilters(advancedToParams(f))).toMatchObject({ side: "LONG", tags: ["a", "b"], dow: [1, 3], flags: ["unreviewed"], status: "open" });
    expect(advancedToParams(parseFilters({}))).toEqual({});
  });
});

describe("fx", () => {
  const rates = [{ base: "USD", quote: "AUD", rate: 1.5 }];
  it("direct, inverse, identity", () => {
    expect(findRate(rates, "USD", "AUD")).toBe(1.5);
    expect(findRate(rates, "AUD", "USD")).toBeCloseTo(1 / 1.5);
    expect(findRate(rates, "AUD", "AUD")).toBe(1);
  });
  it("via USD, and null when unknown", () => {
    const r = [...rates, { base: "USD", quote: "HKD", rate: 7.8 }];
    expect(findRate(r, "AUD", "HKD")).toBeCloseTo((1 / 1.5) * 7.8);
    expect(findRate(rates, "AUD", "JPY")).toBeNull();
  });
  it("only offers currencies that can be converted", () => {
    expect(currencyChoices(rates, "AUD")).toEqual(["AUD", "USD"]);
  });
});
