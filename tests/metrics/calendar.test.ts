import { describe, expect, it } from "vitest";
import { buildMonthGrid, compactMoney, isYearMonth, shiftMonth } from "@/lib/calendar";

const b = (day: string, netPnl: number, trades: number) => ({ day, netPnl, trades, grossPnl: netPnl, volume: 0 });

describe("buildMonthGrid", () => {
  // October 2026 starts on a Thursday
  const weeks = buildMonthGrid(
    "2026-10",
    [b("2026-10-01", 1020, 14), b("2026-10-02", -79.9, 23), b("2026-10-05", 484, 12)],
    "2026-10-10",
  );

  it("pads the first week so the 1st lands on Thursday", () => {
    expect(weeks[0].cells.slice(0, 4).every((c) => c.date === null)).toBe(true);
    expect(weeks[0].cells[4].date).toBe("2026-10-01");
  });
  it("covers the whole month in whole weeks", () => {
    expect(weeks).toHaveLength(5);
    expect(weeks.flatMap((w) => w.cells).filter((c) => c.date).length).toBe(31);
  });
  it("marks today and future days", () => {
    const cells = weeks.flatMap((w) => w.cells);
    expect(cells.find((c) => c.date === "2026-10-10")?.isToday).toBe(true);
    expect(cells.find((c) => c.date === "2026-10-11")?.isFuture).toBe(true);
    expect(cells.find((c) => c.date === "2026-10-09")?.isFuture).toBe(false);
  });
  it("weekly totals", () => {
    expect(weeks[0]).toMatchObject({ netPnl: 940.1, trades: 37, tradingDays: 2 });
    expect(weeks[1]).toMatchObject({ netPnl: 484, trades: 12, tradingDays: 1 });
    expect(weeks[2]).toMatchObject({ netPnl: 0, trades: 0, tradingDays: 0 });
  });
  it("days without trades have null P&L", () => {
    expect(weeks[1].cells[0].netPnl).toBeNull(); // Sun 4th
  });
});

describe("compactMoney", () => {
  it("matches the reference formatting", () => {
    expect(compactMoney(1020)).toBe("A$1.02K");
    expect(compactMoney(-79.9)).toBe("−A$79.9");
    expect(compactMoney(93.1)).toBe("A$93.1");
    expect(compactMoney(484)).toBe("A$484");
    expect(compactMoney(-720)).toBe("−A$720");
    expect(compactMoney(-1240)).toBe("−A$1.24K");
    expect(compactMoney(1860)).toBe("A$1.86K");
    expect(compactMoney(12500)).toBe("A$12.5K");
    expect(compactMoney(0)).toBe("A$0");
  });
});

describe("month helpers", () => {
  it("shifts across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("validates year-month strings", () => {
    expect(isYearMonth("2026-10")).toBe(true);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth(undefined)).toBe(false);
  });
});
