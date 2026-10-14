import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loadAnswer } from "@/lib/training/service";

export const maxDuration = 60;

/** "Show me the answer": reveals the expert's trade and the following candles; nothing is recorded. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await loadAnswer((await ctx.params).id, new URL(req.url).searchParams.get("tf") ?? undefined);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.value, { headers: { "cache-control": "no-store" } });
}
