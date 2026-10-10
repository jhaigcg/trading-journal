import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { syncAccountStep } from "@/lib/import/sync";
import { getSession } from "@/lib/session";

export const maxDuration = 60; // Vercel: allow the 40 s sync budget plus overhead

const body = z.object({ accountId: z.string().min(1) });

/** Run one resumable sync step for an account. The client calls this repeatedly until status is "done" or "error". */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "accountId required" }, { status: 400 });

  const acc = await db.account.findUnique({ where: { id: parsed.data.accountId }, select: { id: true, metaapiAccountId: true } });
  if (!acc) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (!acc.metaapiAccountId) return NextResponse.json({ status: "error", message: "This account is not connected to MT4.", progress: 0, created: 0, updated: 0 });

  return NextResponse.json(await syncAccountStep(acc.id));
}
