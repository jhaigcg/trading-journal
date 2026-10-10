import { db } from "@/lib/db";
import { parseDrawings, readDrawings } from "./validate";
import type { Drawing } from "./types";

export type SaveResult = { ok: true; count: number } | { ok: false; status: 400 | 404; error: string };

/** Replace the drawings on a trade's chart. */
export async function saveDrawings(tradeId: string, raw: unknown): Promise<SaveResult> {
  const parsed = parseDrawings(raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const done = await db.trade.updateMany({ where: { id: tradeId }, data: { chartDrawings: parsed.value as unknown as object } });
  if (!done.count) return { ok: false, status: 404, error: "That trade no longer exists." };
  return { ok: true, count: parsed.value.length };
}

export async function loadDrawings(tradeId: string): Promise<Drawing[]> {
  const t = await db.trade.findUnique({ where: { id: tradeId }, select: { chartDrawings: true } });
  return readDrawings(t?.chartDrawings);
}
