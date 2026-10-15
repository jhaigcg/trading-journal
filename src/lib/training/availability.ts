/** Prices for a UTC day are published once that day has ended, so the latest usable moment is the end of the last finished day. */
export const startOfUtcDay = (sec: number) => Math.floor(sec / 86_400) * 86_400;

/** The last minute of the most recent finished UTC day, as unix seconds. */
export const latestAvailable = (nowSec: number) => startOfUtcDay(nowSec) - 60;

const dayLabel = (sec: number) => new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(sec * 1000));

/**
 * Plain-words reason the prices for a decision moment cannot be loaded yet, or null when they can.
 * `fmt` writes a moment in the reader's own timezone.
 */
export function unavailableReason(atSec: number, nowSec: number, fmt: (sec: number) => string): string | null {
  if (!Number.isFinite(atSec)) return "Enter the decision time first.";
  const latest = latestAvailable(nowSec);
  if (atSec <= latest) return null;
  return `Prices for ${dayLabel(atSec)} (UTC) are published only after that day ends at 00:00 UTC, so they are not available yet. The latest time you can use right now is ${fmt(latest)}.`;
}
