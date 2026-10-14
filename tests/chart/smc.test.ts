import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market-data/types";
import { computeZones, NO_OVERLAYS, ZONES_OFF, zonesAvailable } from "@/lib/smc";

const c = (i: number, o: number, h: number, l: number, cl: number): Candle => ({ t: 1000 + i * 300, o, h, l, c: cl, v: 1 });
const gap = [c(0, 9, 10, 8, 9.5), c(1, 9.5, 13, 9.4, 12.8), c(2, 12.8, 14, 12, 13.5)];

describe("computeZones", () => {
  it("draws nothing when everything is off, or when there are no candles", () => {
    expect(computeZones(gap, ZONES_OFF)).toBe(NO_OVERLAYS);
    expect(computeZones([], { ...ZONES_OFF, fvg: true })).toBe(NO_OVERLAYS);
  });
  it("a standing gap is a box placed by candle position, from the first candle to 20 bars past the one that formed it", () => {
    const z = computeZones(gap, { ...ZONES_OFF, fvg: true }).zones;
    expect(z).toEqual([{ kind: "FVG", side: "bull", top: 12, bottom: 10, startT: gap[0].t, endT: null, startIdx: 0, endIdx: 22 }]);
  });
  it("a gap that a close has gone through is no longer drawn", () => {
    expect(computeZones([...gap, c(3, 13.5, 13.6, 9, 9.5)], { ...ZONES_OFF, fvg: true }).zones).toEqual([]);
  });
  it("only the switches that are on produce anything", () => {
    const r = computeZones(gap, { ...ZONES_OFF, structure: true, eq: true });
    expect(r.zones).toEqual([]);
    expect(r.eq).toEqual([]);
    expect(r.trailing).not.toBeNull();
  });
  it("keeps only the newest standing gaps", () => {
    const many = Array.from({ length: 30 }, (_, i) => [c(i * 3, 10 + i * 5, 11 + i * 5, 9 + i * 5, 10.5 + i * 5), c(i * 3 + 1, 11 + i * 5, 15 + i * 5, 10.9 + i * 5, 14.9 + i * 5), c(i * 3 + 2, 14.9 + i * 5, 17 + i * 5, 13 + i * 5, 16 + i * 5)]).flat();
    const z = computeZones(many, { ...ZONES_OFF, fvg: true }, 5).zones;
    expect(z.length).toBeGreaterThan(0);
    expect(z.length).toBeLessThanOrEqual(5);
  });
  it("only the 5 and 15 minute charts offer overlays", () => {
    expect(zonesAvailable("M5")).toBe(true);
    expect(zonesAvailable("M15")).toBe(true);
    for (const tf of ["M1", "H1", "H4", "D1", "S5"]) expect(zonesAvailable(tf)).toBe(false);
  });
});
