import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncAccountStep } from "@/lib/import/sync";

export const maxDuration = 60;

/** Daily safety-net sync (Vercel Cron). Protected by CRON_SECRET, not by the login session. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const accounts = await db.account.findMany({ where: { archived: false, syncType: "AUTO_METAAPI", metaapiAccountId: { not: null } }, select: { id: true } });
  const results: Record<string, string> = {};
  for (const a of accounts) results[a.id] = (await syncAccountStep(a.id, { budgetMs: 40_000 / Math.max(1, accounts.length) })).status;
  return NextResponse.json({ results });
}
