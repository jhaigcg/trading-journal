import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { submitAttempt } from "@/lib/training/service";

export const maxDuration = 60;

/** Judge the player's trade on the real candles that followed, then reveal the answer. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const r = await submitAttempt((await ctx.params).id, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.value, { headers: { "cache-control": "no-store" } });
}
