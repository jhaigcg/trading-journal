import { NextResponse } from "next/server";
import { isTimeframe } from "@/lib/market-data/types";
import { defaultTimeframe, loadChart } from "@/lib/queries/trade-chart";
import { loadTradeDetail } from "@/lib/queries/trade-detail";
import { getSession } from "@/lib/session";

export const maxDuration = 60; // first view of a trade may download price data

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const trade = await loadTradeDetail({ id: (await ctx.params).id });
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tfParam = new URL(req.url).searchParams.get("tf") ?? "";
  const tf = isTimeframe(tfParam) ? tfParam : defaultTimeframe(trade.holdSeconds);
  const warmParam = Number(new URL(req.url).searchParams.get("warm"));
  const warm = Number.isFinite(warmParam) ? Math.min(1500, Math.max(0, Math.floor(warmParam))) : 0;
  return NextResponse.json(await loadChart(trade, tf, new Date(), warm), { headers: { "cache-control": "no-store" } });
}
