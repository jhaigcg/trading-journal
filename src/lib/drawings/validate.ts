import { z } from "zod";
import { DRAWING_COLORS, DRAWING_KINDS, MAX_DRAWINGS, POINTS_NEEDED, type Drawing } from "./types";

const point = z.object({ t: z.number().int().min(0).max(4_102_444_800), p: z.number().finite().min(-1e9).max(1e9) });

const drawing = z
  .object({
    id: z.string().min(1).max(40),
    kind: z.enum(DRAWING_KINDS),
    color: z.enum(DRAWING_COLORS),
    points: z.array(point).max(2),
    text: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.points.length === POINTS_NEEDED[d.kind], { message: "A drawing has the wrong number of points." })
  .refine((d) => d.kind !== "note" || !!d.text, { message: "A note needs some text." });

const list = z.array(drawing).max(MAX_DRAWINGS, `At most ${MAX_DRAWINGS} drawings per trade.`).refine((l) => new Set(l.map((d) => d.id)).size === l.length, { message: "Duplicate drawing ids." });

/** Check what the browser sent. Anything unexpected is refused rather than stored; extra fields are dropped. */
export function parseDrawings(raw: unknown): { ok: true; value: Drawing[] } | { ok: false; error: string } {
  const r = list.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Those drawings could not be saved." };
  return { ok: true, value: r.data.map((d) => ({ id: d.id, kind: d.kind, color: d.color, points: d.points, ...(d.text ? { text: d.text } : {}) })) };
}

/** Read drawings back from the database, skipping anything that no longer validates instead of failing the page. */
export function readDrawings(stored: unknown): Drawing[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((d) => {
    const r = drawing.safeParse(d);
    return r.success ? [{ id: r.data.id, kind: r.data.kind, color: r.data.color, points: r.data.points, ...(r.data.text ? { text: r.data.text } : {}) }] : [];
  });
}
