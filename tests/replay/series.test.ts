import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/types";
import { chooseTimeframe, combinedPnl, indexAt, pnlAt, startIndex, type PnlTrade } from "@/lib/replay/series";

const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({ t: 1000 + i * 60, o: 1, h: 2, l: 0, c: 1, v: 0 }));
const tr = (open: number, close: number | null, pts: [number, number][], final: number): PnlTrade => ({ open, close, points: pts.map(([t, pnl]) => ({ t, pnl })), final });

describe("pnlAt", () => {
  const t = tr(1100, 1400, [[1100, 0], [1160, 5], [1220, -3], [1400, 12]], 12);
  it("is zero before the trade, running while open, final after", () => {
    expect(pnlAt(t, 1099)).toBe(0);
    expect(pnlAt(t, 1100)).toBe(0);
    expect(pnlAt(t, 1170)).toBe(5);
    expect(pnlAt(t, 1230)).toBe(-3);
    expect(pnlAt(t, 1400)).toBe(12);
    expect(pnlAt(t, 99999)).toBe(12);
  });
  it("a trade that is still open keeps its latest value", () => {
    const open = tr(1100, null, [[1100, 0], [1160, 7]], 0);
    expect(pnlAt(open, 99999)).toBe(7);
  });
});

describe("combinedPnl", () => {
  it("adds trades up at each candle close, and a closed trade stays in the total", () => {
    const a = tr(1060, 1240, [[1060, 0], [1120, 10], [1180, 20], [1240, 15]], 15);
    const b = tr(1180, 1360, [[1180, 0], [1240, -4], [1300, -8], [1360, -6]], -6);
    const out = combinedPnl(candles, 60, [a, b]);
    expect(out.length).toBe(candles.length);
    // candle 0 closes at 1060 (a opens, 0), candle 2 closes at 1180: a=20, b=0
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(20);
    expect(out[3]).toBe(15 - 4 + 0); // t=1240: a closed at 15, b at -4
    expect(out[9]).toBe(15 - 6);
  });
  it("no trades gives zeros", () => {
    expect(combinedPnl(candles, 60, [])).toEqual(candles.map(() => 0));
  });
});

describe("chooseTimeframe", () => {
  it("keeps the requested timeframe when the window is small enough", () => {
    expect(chooseTimeframe("M1", 3 * 3600)).toBe("M1");
  });
  it("coarsens only as far as needed and never goes finer", () => {
    expect(chooseTimeframe("M1", 3 * 86_400)).toBe("M5");
    expect(chooseTimeframe("M5", 3 * 3600)).toBe("M5");
    expect(chooseTimeframe("M1", 400 * 86_400)).toBe("H4"); // 400 days of 4h bars = 2400
    expect(chooseTimeframe("M1", 4000 * 86_400)).toBe("D1");
  });
});

describe("indexAt / startIndex", () => {
  it("finds the candle containing a time, or the latest before it", () => {
    expect(indexAt(candles, 1000)).toBe(0);
    expect(indexAt(candles, 1119)).toBe(1);
    expect(indexAt(candles, 1120)).toBe(2);
    expect(indexAt(candles, 999)).toBe(-1);
    expect(indexAt(candles, 99999)).toBe(9);
  });
  it("playback starts one candle before the entry, never below zero", () => {
    expect(startIndex(candles, 1190)).toBe(2);
    expect(startIndex(candles, 1000)).toBe(0);
    expect(startIndex(candles, 500)).toBe(0);
  });
});
