import { NextResponse } from "next/server";
import { saveDrawings } from "@/lib/drawings/store";
import { getSession } from "@/lib/session";

/** Save the drawings on a trade's chart (the whole list, replacing what was there). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const r = await saveDrawings((await ctx.params).id, body?.drawings);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, count: r.count });
}
