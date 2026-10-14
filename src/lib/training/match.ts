import { rrOf, type Order, type Side } from "./sim";

export interface Expert {
  side: Side;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
}

export interface MatchPart {
  key: "direction" | "entry" | "stop" | "target" | "rr";
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface Match {
  total: number;
  parts: MatchPart[];
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const f2 = (n: number) => n.toFixed(2);

/** The expert's answer as a single order, with the middle of the entry zone as the entry. */
export const expertOrder = (e: Expert): Order => ({ side: e.side, entry: (e.entryLow + e.entryHigh) / 2, stopLoss: e.stopLoss, takeProfit: e.takeProfit });

/**
 * How closely an attempt matches the expert answer, out of 100:
 *   direction 30 (wrong direction scores nothing at all), entry 25, stop 20, target 15, risk-to-reward 10.
 * Distances are measured in the expert's risk (or reward for the target), so the same rules work for a $3 scalp and
 * a $40 swing. The entry is a zone, not a price: anywhere inside it is full marks.
 */
export function matchScore(user: Order, expert: Expert): Match {
  const parts: MatchPart[] = [];
  const add = (key: MatchPart["key"], label: string, max: number, fraction: number, note: string) => parts.push({ key, label, max, points: Math.round(max * clamp(fraction)), note });

  if (user.side !== expert.side) {
    add("direction", "Direction", 30, 0, `The expert took a ${expert.side === "LONG" ? "long" : "short"}.`);
    for (const [key, label, max] of [["entry", "Entry", 25], ["stop", "Stop loss", 20], ["target", "Take profit", 15], ["rr", "Risk to reward", 10]] as const) add(key, label, max, 0, "Not scored: wrong direction.");
    return { total: 0, parts };
  }
  add("direction", "Direction", 30, 1, "Same direction as the expert.");

  const lo = Math.min(expert.entryLow, expert.entryHigh);
  const hi = Math.max(expert.entryLow, expert.entryHigh);
  const mid = (lo + hi) / 2;
  const exRisk = Math.abs(mid - expert.stopLoss) || 1e-9;
  const exReward = Math.abs(expert.takeProfit - mid) || 1e-9;

  const outside = user.entry < lo ? lo - user.entry : user.entry > hi ? user.entry - hi : 0;
  add("entry", "Entry", 25, 1 - outside / exRisk, outside === 0 ? "Inside the expert's entry zone." : `${f2(outside)} outside the entry zone (${f2(lo)} to ${f2(hi)}).`);

  const slOff = Math.abs(user.stopLoss - expert.stopLoss) / exRisk;
  const slTighter = expert.side === "LONG" ? user.stopLoss > expert.stopLoss : user.stopLoss < expert.stopLoss;
  add("stop", "Stop loss", 20, 1 - slOff / 0.75, slOff < 0.1 ? "At the expert's invalidation level." : slTighter ? `Tighter than the invalidation level (${f2(expert.stopLoss)}): it can be swept before the idea plays out.` : `Wider than needed (expert ${f2(expert.stopLoss)}): the same idea risks more.`);

  const tpOff = Math.abs(user.takeProfit - expert.takeProfit) / exReward;
  const tpShort = expert.side === "LONG" ? user.takeProfit < expert.takeProfit : user.takeProfit > expert.takeProfit;
  add("target", "Take profit", 15, 1 - tpOff / 0.5, tpOff < 0.05 ? "At the expert's target." : tpShort ? `Short of the expert's target (${f2(expert.takeProfit)}): you leave the move early.` : `Beyond the expert's target (${f2(expert.takeProfit)}): the liquidity may not be reached.`);

  const ratio = rrOf(user) / (rrOf(expertOrder(expert)) || 1e-9);
  const off = Math.abs(Math.log2(Math.max(ratio, 1e-9)));
  add("rr", "Risk to reward", 10, 1 - Math.max(0, off - 0.5) / 1.5, `Your risk to reward is 1:${f2(rrOf(user))}, the expert's is 1:${f2(rrOf(expertOrder(expert)))}.`);

  return { total: parts.reduce((s, p) => s + p.points, 0), parts };
}

/** Plain-words check that an expert answer hangs together (used when a scenario is saved). */
export function validateExpert(e: Expert): string | null {
  const lo = Math.min(e.entryLow, e.entryHigh);
  const hi = Math.max(e.entryLow, e.entryHigh);
  if (![e.entryLow, e.entryHigh, e.stopLoss, e.takeProfit].every((n) => Number.isFinite(n) && n > 0)) return "Set the entry zone, stop loss and take profit.";
  if (e.side === "LONG") {
    if (!(e.stopLoss < lo)) return "For a long, the stop loss must be below the entry zone.";
    if (!(e.takeProfit > hi)) return "For a long, the take profit must be above the entry zone.";
  } else {
    if (!(e.stopLoss > hi)) return "For a short, the stop loss must be above the entry zone.";
    if (!(e.takeProfit < lo)) return "For a short, the take profit must be below the entry zone.";
  }
  return null;
}
