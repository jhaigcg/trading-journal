import type { Timeframe } from "./types";

/** A sensible first timeframe for a trade of this length (pure, so it is safe in client components). */
export function defaultTimeframe(holdSeconds: number | null): Timeframe {
  const s = holdSeconds ?? 3600;
  if (s <= 10 * 60) return "M1";
  if (s <= 4 * 3600) return "M5";
  if (s <= 16 * 3600) return "M15";
  if (s <= 4 * 86_400) return "H1";
  if (s <= 16 * 86_400) return "H4";
  return "D1";
}
