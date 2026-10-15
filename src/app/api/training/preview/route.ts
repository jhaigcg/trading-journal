import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { settingsFor } from "@/lib/queries/trade-list";
import { unavailableReason } from "@/lib/training/availability";
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
  if (!Number.isFinite(at)) return NextResponse.json({ error: "Enter the decision time first." }, { status: 400 });
  const { tz } = await settingsFor();
  const fmt = (sec: number) => new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(sec * 1000));
  const pending = unavailableReason(at, Date.now() / 1000, fmt);
  if (pending) return NextResponse.json({ error: pending }, { status: 400 });
  const r = await loadPreview({ symbol: (q.get("symbol") ?? "XAUUSD").toUpperCase(), atSec: Math.floor(at), tf: q.get("tf") ?? "M5", kind, lookbackHours: lookback, horizonMinutes: horizon });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ candles: r.candles, incomplete: r.incomplete }, { headers: { "cache-control": "no-store" } });
}
