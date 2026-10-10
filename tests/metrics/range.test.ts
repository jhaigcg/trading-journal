import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/filters/range";

// 2026-10-14 is a Wednesday
const now = new Date("2026-10-14T03:00:00Z"); // 11:00 in Hong Kong

describe("resolveRange", () => {
  it("this month", () => {
    expect(resolveRange("month", {}, now, "Asia/Hong_Kong")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("this week starts on Monday", () => {
    expect(resolveRange("week", {}, now, "Asia/Hong_Kong")).toEqual({ from: "2026-10-12", to: "2026-10-14" });
  });
  it("last 30 days is inclusive of today", () => {
    expect(resolveRange("30d", {}, now, "Asia/Hong_Kong")).toEqual({ from: "2026-09-15", to: "2026-10-14" });
  });
  it("uses the display timezone for 'today'", () => {
    const late = new Date("2026-10-13T18:30:00Z"); // already 14 Oct in Hong Kong
    expect(resolveRange("today", {}, late, "Asia/Hong_Kong")).toEqual({ from: "2026-10-14", to: "2026-10-14" });
  });
  it("ytd, all, custom", () => {
    expect(resolveRange("ytd", {}, now, "Asia/Hong_Kong").from).toBe("2026-01-01");
    expect(resolveRange("all")).toEqual({ from: null, to: null });
    expect(resolveRange("custom", { from: "2026-01-05", to: "2026-02-01" })).toEqual({ from: "2026-01-05", to: "2026-02-01" });
  });
});
