import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { refreshDailySummary } from "@/lib/import/persist";
import { displaySchema, firstError, passwordSchema, type DisplayInput } from "./validate";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Trades store a few values that were worked out from the settings when they were saved: the trading day in your
 * timezone (open and close), whether the trade was intraday, and win/loss/breakeven. When the timezone or the
 * breakeven threshold changes they all have to be recomputed, or the old numbers would quietly disagree with the new setting.
 */
export async function recomputeDerived(tz: string, threshold: number): Promise<{ trades: number }> {
  const open = `(("openedAt" AT TIME ZONE 'UTC') AT TIME ZONE $1)::date`;
  const close = `(("closedAt" AT TIME ZONE 'UTC') AT TIME ZONE $1)::date`;
  const trades = await db.$executeRawUnsafe(
    `UPDATE "Trade" SET
       "openDay" = ${open},
       "closeDay" = CASE WHEN "closedAt" IS NULL THEN NULL ELSE ${close} END,
       "intraday" = ("closedAt" IS NULL OR ${open} = ${close}),
       "result" = CASE WHEN "status" = 'CLOSED' THEN
           (CASE WHEN "netPnl" > $2::numeric THEN 'WIN' WHEN "netPnl" < -($2::numeric) THEN 'LOSS' ELSE 'BREAKEVEN' END)::"TradeResult"
         ELSE NULL END`,
    tz,
    threshold,
  );
  const accounts = await db.account.findMany({ select: { id: true } });
  await db.dailySummary.deleteMany({});
  for (const a of accounts) {
    const days = await db.trade.findMany({ where: { accountId: a.id, status: "CLOSED", closeDay: { not: null } }, select: { closeDay: true }, distinct: ["closeDay"] });
    await refreshDailySummary(a.id, days.map((d) => d.closeDay!.toISOString().slice(0, 10)), threshold);
  }
  return { trades };
}

/** Save timezone, home currency and breakeven threshold; recompute stored values only when they depend on what changed. */
export async function applyDisplaySettings(raw: unknown): Promise<Result<{ recomputed: number | null }>> {
  const parsed = displaySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v: DisplayInput = parsed.data;
  const before = await db.setting.findUnique({ where: { id: 1 } });
  const changed = !before || before.displayTimezone !== v.timezone || Number(before.breakevenThreshold) !== v.threshold;
  await db.setting.upsert({
    where: { id: 1 },
    update: { displayTimezone: v.timezone, displayCurrency: v.currency, breakevenThreshold: v.threshold },
    create: { id: 1, displayTimezone: v.timezone, displayCurrency: v.currency, breakevenThreshold: v.threshold },
  });
  const r = changed ? await recomputeDerived(v.timezone, v.threshold) : null;
  return { ok: true, recomputed: r ? r.trades : null };
}

export async function changePassword(userId: string, raw: unknown): Promise<Result> {
  const parsed = passwordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Your account was not found. Sign in again." };
  if (!(await bcrypt.compare(parsed.data.current, user.passwordHash))) return { ok: false, error: "Your current password is not correct." };
  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(parsed.data.next, 12) } });
  return { ok: true };
}
