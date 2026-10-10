"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildManualTrade } from "@/lib/import/manual";
import { loadSymbols, persistTrades, refreshDailySummary } from "@/lib/import/persist";
import { normaliseSymbol } from "@/lib/import/symbols";
import { getSession } from "@/lib/session";
import { DEFAULT_TZ, localToUtc } from "@/lib/time";

export type ManualTradeState = { error?: string } | undefined;

const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().finite().nullable());

const schema = z.object({
  accountId: z.string().min(1, "Choose an account."),
  symbol: z.string().trim().min(2, "Enter a symbol.").max(20),
  side: z.enum(["LONG", "SHORT"]),
  strategyId: z.string().optional(),
  grossPnl: z.coerce.number({ message: "Enter the gross P&L (use 0 for an open trade)." }).finite(),
  swap: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().finite()),
  stopLoss: optNum,
  takeProfit: optNum,
  comment: z.string().max(500).optional(),
  executions: z.string().transform((s, ctx) => {
    try {
      return z
        .array(z.object({ kind: z.enum(["ENTRY", "EXIT"]), at: z.string(), price: z.coerce.number(), lots: z.coerce.number(), fee: z.coerce.number().min(0).default(0) }))
        .parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: "custom", message: "Check the fills: every row needs a time, price and lots." });
      return z.NEVER;
    }
  }),
});

export async function createManualTrade(_prev: ManualTradeState, form: FormData): Promise<ManualTradeState> {
  if (!(await getSession())) redirect("/login");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const account = await db.account.findUnique({ where: { id: v.accountId } });
  if (!account) return { error: "Account not found." };
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  const tz = settings?.displayTimezone ?? DEFAULT_TZ;
  const symbols = await loadSymbols();

  const built = buildManualTrade({
    brokerTicket: `manual-${randomUUID().slice(0, 8)}`,
    symbol: normaliseSymbol(v.symbol, symbols),
    side: v.side,
    executions: v.executions.map((e) => ({ kind: e.kind, at: localToUtc(e.at, tz), price: e.price, lots: e.lots, fee: e.fee })),
    grossPnl: v.grossPnl,
    swap: v.swap,
    stopLoss: v.stopLoss,
    takeProfit: v.takeProfit,
    comment: v.comment?.trim() || null,
  });
  if ("error" in built) return { error: built.error };

  const threshold = Number(settings?.breakevenThreshold ?? 0);
  const result = await persistTrades({ accountId: account.id, tz, breakevenThreshold: threshold, symbols }, [built.trade]);
  if (v.strategyId) {
    await db.trade.updateMany({ where: { accountId: account.id, brokerTicket: built.trade.brokerTicket }, data: { strategyId: v.strategyId } });
  }
  await refreshDailySummary(account.id, result.touchedDays, threshold);

  revalidatePath("/dashboard");
  revalidatePath("/trades");
  redirect("/trades/new?saved=1");
}
