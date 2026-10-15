import { describe, expect, it } from "vitest";
import { latestAvailable, unavailableReason } from "@/lib/training/availability";

const utc = (s: string) => Date.parse(s) / 1000;
const fmt = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16);

describe("which moments have published prices", () => {
  const now = utc("2026-10-15T06:35:00Z");
  it("the latest usable minute is the end of the last finished UTC day", () => {
    expect(latestAvailable(now)).toBe(utc("2026-10-14T23:59:00Z"));
  });
  it("a moment on the current UTC day is not available yet, and the reason names the day and the latest usable time", () => {
    const why = unavailableReason(utc("2026-10-15T06:05:00Z"), now, fmt);
    expect(why).toContain("15 Oct");
    expect(why).toContain("2026-10-14T23:59");
    expect(why).toMatch(/not available yet/);
  });
  it("a moment on a finished day is fine, right up to its last minute", () => {
    expect(unavailableReason(utc("2026-10-14T17:45:00Z"), now, fmt)).toBeNull();
    expect(unavailableReason(utc("2026-10-14T23:59:00Z"), now, fmt)).toBeNull();
    expect(unavailableReason(utc("2026-10-15T00:00:00Z"), now, fmt)).not.toBeNull();
  });
  it("asks for the time when there is none", () => {
    expect(unavailableReason(NaN, now, fmt)).toMatch(/Enter the decision time/);
  });
});
