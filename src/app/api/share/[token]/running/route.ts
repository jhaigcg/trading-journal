import { NextResponse } from "next/server";
import { loadRunning } from "@/lib/queries/trade-chart";
import { loadTradeDetail } from "@/lib/queries/trade-detail";

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const trade = await loadTradeDetail({ shareToken: (await ctx.params).token });
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await loadRunning(trade), { headers: { "cache-control": "no-store" } });
}
