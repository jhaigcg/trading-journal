import { NextResponse } from "next/server";
import { loadTradeDetail } from "@/lib/queries/trade-detail";
import { getSession } from "@/lib/session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const trade = await loadTradeDetail({ id: (await ctx.params).id });
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(trade, { headers: { "cache-control": "no-store" } });
}
