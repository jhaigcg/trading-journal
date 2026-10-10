import { NextResponse } from "next/server";
import { isTimeframe } from "@/lib/market-data/types";
import { defaultTimeframe, loadChart } from "@/lib/queries/trade-chart";
import { loadTradeDetail } from "@/lib/queries/trade-detail";

export const maxDuration = 60;

/** Public read-only chart for a shared trade. The unguessable token is the only credential. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const trade = await loadTradeDetail({ shareToken: (await ctx.params).token });
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tfParam = new URL(req.url).searchParams.get("tf") ?? "";
  const tf = isTimeframe(tfParam) ? tfParam : defaultTimeframe(trade.holdSeconds);
  return NextResponse.json(await loadChart(trade, tf), { headers: { "cache-control": "no-store" } });
}
