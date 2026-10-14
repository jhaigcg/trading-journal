import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loadPreview } from "@/lib/training/scenarios";

export const maxDuration = 60;

/** Prices around a chosen moment, future included, for the scenario editor (the author may see the answer). */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const at = Date.parse(q.get("at") ?? "") / 1000;
  const kind = q.get("kind") === "EVENT" ? "EVENT" : "SETUP";
  const lookback = Math.min(120, Math.max(1, Number(q.get("lookback")) || 24));
  const horizon = Math.min(1440, Math.max(5, Number(q.get("horizon")) || 240));
  if (!Number.isFinite(at) || at > Date.now() / 1000 - 3600) return NextResponse.json({ error: "Pick a time at least an hour in the past." }, { status: 400 });
  const r = await loadPreview({ symbol: (q.get("symbol") ?? "XAUUSD").toUpperCase(), atSec: Math.floor(at), tf: q.get("tf") ?? "M5", kind, lookbackHours: lookback, horizonMinutes: horizon });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ candles: r.candles, incomplete: r.incomplete }, { headers: { "cache-control": "no-store" } });
}
