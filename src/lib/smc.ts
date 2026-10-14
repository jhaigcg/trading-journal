import type { Candle } from "@/lib/market-data/types";
import { computeLuxFvg, computeLuxSmc, type EqEvent, type StructureEvent, type Trailing } from "@/lib/lux-smc";

/**
 * What the smart-money overlays draw. The rules themselves are ports of two LuxAlgo indicators (see lux-smc.ts);
 * this file chooses what to show and shapes it for the charts. Only closed candles are used, so the same code is safe
 * on a trade being reviewed, a replay, and a training scenario that must not reveal the future.
 */
export interface Zone {
  kind: "FVG" | "OB";
  side: "bull" | "bear";
  /** order blocks: from the shorter internal structure rather than the swing structure */
  internal?: boolean;
  top: number;
  bottom: number;
  /** open time of the candle the zone is drawn from */
  startT: number;
  /** open time of the candle that ends it; null runs to the right edge of the chart */
  endT: number | null;
  /** when set, the box is placed by candle position instead (fair value gaps extend a fixed number of bars past the last candle) */
  startIdx?: number;
  endIdx?: number;
}

export interface ZoneChoice {
  fvg: boolean;
  /** order blocks */
  ob: boolean;
  /** BOS / CHoCH lines plus the strong and weak high and low */
  structure: boolean;
  /** equal highs and lows */
  eq: boolean;
}

export const ZONES_OFF: ZoneChoice = { fvg: false, ob: false, structure: false, eq: false };
export const ZONES_ON: ZoneChoice = { fvg: true, ob: true, structure: true, eq: true };

/** The two timeframes these overlays are shown on. */
export const ZONE_TIMEFRAMES = ["M5", "M15"] as const;
export const zonesAvailable = (tf: string) => (ZONE_TIMEFRAMES as readonly string[]).includes(tf);

export interface Overlays {
  zones: Zone[];
  structure: StructureEvent[];
  eq: EqEvent[];
  trailing: Trailing | null;
}

export const NO_OVERLAYS: Overlays = { zones: [], structure: [], eq: [], trailing: null };

/** What to draw for the chosen kinds. Only the newest `limit` standing gaps are kept so a long chart stays readable. */
export function computeZones(candles: Candle[], choice: ZoneChoice, limit = 100): Overlays {
  if (candles.length === 0 || !(choice.fvg || choice.ob || choice.structure || choice.eq)) return NO_OVERLAYS;
  const zones: Zone[] = [];
  if (choice.fvg) {
    for (const g of computeLuxFvg(candles).filter((x) => x.mitigatedIdx == null).slice(-limit)) {
      zones.push({ kind: "FVG", side: g.side, top: g.top, bottom: g.bottom, startT: g.startT, endT: null, startIdx: g.startIdx, endIdx: g.endIdx });
    }
  }
  const lux = choice.ob || choice.structure || choice.eq ? computeLuxSmc(candles) : null;
  if (lux && choice.ob) for (const b of lux.orderBlocks) zones.push({ kind: "OB", side: b.side, top: b.top, bottom: b.bottom, startT: b.startT, endT: null, internal: b.internal });
  return {
    zones,
    structure: lux && choice.structure ? lux.structure.slice(-150) : [],
    eq: lux && choice.eq ? lux.eq.slice(-60) : [],
    trailing: lux && choice.structure ? lux.trailing : null,
  };
}
