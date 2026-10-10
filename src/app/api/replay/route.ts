import { NextResponse } from "next/server";
import { loadDayReplay, loadTradeReplay } from "@/lib/queries/replay";
import { getSession } from "@/lib/session";

export const maxDuration = 60; // the first replay of a day may download price data

/** Replay data for one trade (?trade=ID) or one day (?day=YYYY-MM-DD[&symbol=]), with an optional &tf=. */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const tf = q.get("tf") ?? undefined;
  const trade = q.get("trade");
  const day = q.get("day");
  const data = trade ? await loadTradeReplay(trade, tf) : day ? await loadDayReplay(day, q.get("symbol") ?? undefined, tf) : null;
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
