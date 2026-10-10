import { db } from "@/lib/db";
import { isRealDay } from "@/lib/day";
import { getCandles } from "./candle-cache";

/** How far either side of a trade's day the chart can reach (matches the context shown around a trade). */
const REACH_S = 8 * 3600;
const MAX_DAYS_PER_CALL = 6;

/**
 * Download and store the minute prices around the trades of one trading day, without reading anything back.
 * Called in the background (after the response is sent) so the chart of any trade on that day opens instantly.
 * Safe to call again: days already stored are skipped, and failures are simply retried on the next view.
 */
export async function warmDay(day: string, now = new Date()): Promise<void> {
  if (!isRealDay(day)) return;
  const rows = await db.trade.groupBy({
    by: ["symbol"],
    where: { closeDay: new Date(`${day}T00:00:00Z`), status: "CLOSED" },
    _min: { openedAt: true },
    _max: { closedAt: true },
  });
  for (const r of rows) {
    if (!r._min.openedAt || !r._max.closedAt) continue;
    const from = Math.floor(r._min.openedAt.getTime() / 1000) - REACH_S;
    const to = Math.ceil(r._max.closedAt.getTime() / 1000) + REACH_S;
    await getCandles(r.symbol, "M1", from, to, { now, maxFetch: MAX_DAYS_PER_CALL }).catch(() => undefined);
  }
}

/** Warm the most recent trading days that have trades (used right after new trades arrive from the EA). */
export async function warmRecent(accountId: string, days = 3, now = new Date()): Promise<void> {
  const recent = await db.trade.findMany({
    where: { accountId, status: "CLOSED", closeDay: { not: null } },
    distinct: ["closeDay"],
    orderBy: { closeDay: "desc" },
    take: days,
    select: { closeDay: true },
  });
  for (const r of recent) await warmDay(r.closeDay!.toISOString().slice(0, 10), now);
}
