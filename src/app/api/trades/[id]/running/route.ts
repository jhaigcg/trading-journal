import { NextResponse } from "next/server";
import { loadRunning } from "@/lib/queries/trade-chart";
import { loadTradeDetail } from "@/lib/queries/trade-detail";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const trade = await loadTradeDetail({ id: (await ctx.params).id });
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await loadRunning(trade, { persist: true }), { headers: { "cache-control": "no-store" } });
}
