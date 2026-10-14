import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loadQuestion } from "@/lib/training/service";

export const maxDuration = 60; // the first view of a day may download prices

/** The scenario as the player may see it before answering: no expert answer, notes or screenshot, and no future candles. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await loadQuestion((await ctx.params).id, new URL(req.url).searchParams.get("tf") ?? undefined);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.value, { headers: { "cache-control": "no-store" } });
}
