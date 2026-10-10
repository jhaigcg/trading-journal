"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { deriveRisk } from "@/lib/trades/derive";
import { parseNoteDoc } from "@/lib/notes/doc";
import { checkImage, deleteFile, putImage } from "@/lib/storage";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

const id = z.string().min(1).max(64);
const price = z.number().positive().finite();

// ───────────── editing a trade ─────────────

const patchSchema = z.object({
  stopLoss: price.nullable().optional(),
  profitTarget: price.nullable().optional(),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable().optional(),
  strategyId: id.nullable().optional(),
});

export interface RiskResult {
  tradeRisk: number | null;
  plannedR: number | null;
  realizedR: number | null;
}

/** Edit stop, target, rating or strategy. Risk and R multiples are recalculated from the new values. */
export async function updateTradeFields(tradeId: string, patch: z.input<typeof patchSchema>): Promise<Ok<RiskResult>> {
  await requireSession();
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) return fail("That value is not valid.");
  const p = parsed.data;

  const t = await db.trade.findUnique({ where: { id: tradeId } });
  if (!t) return fail("Trade not found.");
  const sym = await db.symbolConfig.findUnique({ where: { symbol: t.symbol } });
  const entry = Number(t.avgEntry);
  const long = t.side === "LONG";

  const stopLoss = "stopLoss" in p ? (p.stopLoss ?? null) : t.stopLoss == null ? null : Number(t.stopLoss);
  const profitTarget = "profitTarget" in p ? (p.profitTarget ?? null) : t.profitTarget == null ? null : Number(t.profitTarget);
  if (stopLoss != null && (long ? stopLoss >= entry : stopLoss <= entry)) return fail(`A stop loss for a ${long ? "long" : "short"} must be ${long ? "below" : "above"} the entry price (${entry}).`);
  if (profitTarget != null && (long ? profitTarget <= entry : profitTarget >= entry)) return fail(`A profit target for a ${long ? "long" : "short"} must be ${long ? "above" : "below"} the entry price (${entry}).`);

  if (p.strategyId) {
    if (!(await db.strategy.findUnique({ where: { id: p.strategyId }, select: { id: true } }))) return fail("Strategy not found.");
  }

  // the target set in the journal is the plan, so it also becomes the "initial target" the planned R is measured against
  const initialTarget = "profitTarget" in p ? profitTarget : t.initialTarget == null ? null : Number(t.initialTarget);
  const risk = deriveRisk(
    { side: t.side, status: t.status, avgEntry: entry, avgExit: t.avgExit == null ? null : Number(t.avgExit), quantity: Number(t.quantity), grossPnl: Number(t.grossPnl), netPnl: Number(t.netPnl), stopLoss, initialTarget },
    Number(sym?.contractSize ?? 100),
  );

  await db.$transaction(async (tx) => {
    await tx.trade.update({
      where: { id: tradeId },
      data: {
        stopLoss,
        profitTarget,
        initialTarget,
        tradeRisk: risk.tradeRisk,
        plannedR: risk.plannedR,
        realizedR: risk.realizedR,
        ...("rating" in p ? { rating: p.rating ?? null } : {}),
        ...("strategyId" in p ? { strategyId: p.strategyId ?? null } : {}),
      },
    });
    if ("strategyId" in p) {
      // rule answers belong to the strategy they were answered for
      await tx.tradeRuleCheck.deleteMany({ where: { tradeId, ...(p.strategyId ? { rule: { group: { strategyId: { not: p.strategyId } } } } : {}) } });
    }
  });
  revalidateTrade(tradeId);
  return { ok: true, ...risk };
}

export async function setReviewed(tradeId: string, reviewed: boolean): Promise<Ok> {
  await requireSession();
  const r = await db.trade.updateMany({ where: { id: tradeId }, data: { reviewed } });
  if (!r.count) return fail("Trade not found.");
  revalidateTrade(tradeId);
  return { ok: true };
}

/** Answer one strategy rule for a trade: true = followed, false = broken, null = clear. */
export async function setRuleCheck(tradeId: string, ruleId: string, followed: boolean | null): Promise<Ok> {
  await requireSession();
  const trade = await db.trade.findUnique({ where: { id: tradeId }, select: { strategyId: true } });
  const rule = await db.strategyRule.findUnique({ where: { id: ruleId }, select: { group: { select: { strategyId: true } } } });
  if (!trade?.strategyId || rule?.group.strategyId !== trade.strategyId) return fail("That rule does not belong to this trade's strategy.");
  if (followed === null) await db.tradeRuleCheck.deleteMany({ where: { tradeId, ruleId } });
  else await db.tradeRuleCheck.upsert({ where: { tradeId_ruleId: { tradeId, ruleId } }, update: { followed }, create: { tradeId, ruleId, followed } });
  revalidateTrade(tradeId);
  return { ok: true };
}

export async function setTradeTags(tradeId: string, tagIds: string[]): Promise<Ok> {
  await requireSession();
  const ids = [...new Set(z.array(id).max(100).parse(tagIds))];
  const valid = await db.tag.findMany({ where: { id: { in: ids } }, select: { id: true } });
  await db.$transaction([
    db.tradeTag.deleteMany({ where: { tradeId } }),
    db.tradeTag.createMany({ data: valid.map((t) => ({ tradeId, tagId: t.id })), skipDuplicates: true }),
  ]);
  revalidateTrade(tradeId);
  return { ok: true };
}

/** Turn the public read-only link on or off. Returns the token when on. */
export async function setShare(tradeId: string, enabled: boolean): Promise<Ok<{ token: string | null }>> {
  await requireSession();
  const t = await db.trade.findUnique({ where: { id: tradeId }, select: { shareToken: true } });
  if (!t) return fail("Trade not found.");
  const token = enabled ? (t.shareToken ?? randomBytes(18).toString("base64url")) : null;
  await db.trade.update({ where: { id: tradeId }, data: { shareToken: token } });
  revalidateTrade(tradeId);
  return { ok: true, token };
}

function revalidateTrade(tradeId: string) {
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/trades");
  revalidatePath("/dashboard");
}

// ───────────── bulk actions ─────────────

const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("strategy"), ids: z.array(id).min(1).max(5000), strategyId: id.nullable() }),
  z.object({ action: z.literal("addTags"), ids: z.array(id).min(1).max(5000), tagIds: z.array(id).min(1).max(50) }),
  z.object({ action: z.literal("reviewed"), ids: z.array(id).min(1).max(5000), reviewed: z.boolean() }),
  z.object({ action: z.literal("delete"), ids: z.array(id).min(1).max(5000) }),
]);

export async function bulkAction(input: z.input<typeof bulkSchema>): Promise<Ok<{ count: number }>> {
  await requireSession();
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return fail("Nothing selected.");
  const b = parsed.data;
  let count = 0;

  switch (b.action) {
    case "reviewed":
      count = (await db.trade.updateMany({ where: { id: { in: b.ids } }, data: { reviewed: b.reviewed } })).count;
      break;
    case "strategy": {
      if (b.strategyId && !(await db.strategy.findUnique({ where: { id: b.strategyId }, select: { id: true } }))) return fail("Strategy not found.");
      await db.tradeRuleCheck.deleteMany({ where: { tradeId: { in: b.ids }, ...(b.strategyId ? { rule: { group: { strategyId: { not: b.strategyId } } } } : {}) } });
      count = (await db.trade.updateMany({ where: { id: { in: b.ids } }, data: { strategyId: b.strategyId } })).count;
      break;
    }
    case "addTags": {
      const tags = await db.tag.findMany({ where: { id: { in: b.tagIds } }, select: { id: true } });
      const rows = b.ids.flatMap((tradeId) => tags.map((t) => ({ tradeId, tagId: t.id })));
      for (let i = 0; i < rows.length; i += 2000) await db.tradeTag.createMany({ data: rows.slice(i, i + 2000), skipDuplicates: true });
      count = b.ids.length;
      break;
    }
    case "delete": {
      const files = await db.attachment.findMany({ where: { tradeId: { in: b.ids } }, select: { storageKey: true } });
      count = (await db.trade.deleteMany({ where: { id: { in: b.ids } } })).count;
      await Promise.all(files.map((f) => deleteFile(f.storageKey)));
      break;
    }
  }
  revalidatePath("/trades");
  revalidatePath("/dashboard");
  return { ok: true, count };
}

// ───────────── screenshots ─────────────

export async function uploadAttachment(tradeId: string, form: FormData): Promise<Ok<{ id: string }>> {
  await requireSession();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose an image first.");
  if (!(await db.trade.findUnique({ where: { id: tradeId }, select: { id: true } }))) return fail("Trade not found.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkImage(file.type, bytes);
  if (!check.ok) return fail(check.error);
  const key = await putImage(`trades/${tradeId}`, check.ext, bytes, file.type);
  const row = await db.attachment.create({ data: { tradeId, storageKey: key, mime: file.type, sizeBytes: bytes.length } });
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, id: row.id };
}

export async function deleteAttachment(attachmentId: string): Promise<Ok> {
  await requireSession();
  const a = await db.attachment.findUnique({ where: { id: attachmentId } });
  if (!a) return fail("Attachment not found.");
  await db.attachment.delete({ where: { id: attachmentId } });
  await deleteFile(a.storageKey);
  if (a.tradeId) revalidatePath(`/trades/${a.tradeId}`);
  return { ok: true };
}

// ───────────── notes ─────────────

export interface NoteDTO {
  id: string | null;
  content: unknown;
  /** default template for an empty note */
  template: unknown;
  updatedAt: string | null;
}

const noteTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TRADE"), tradeId: id }),
  z.object({ kind: z.literal("DAILY"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);

async function findNote(t: z.infer<typeof noteTarget>) {
  return t.kind === "TRADE"
    ? db.note.findFirst({ where: { kind: "TRADE", tradeId: t.tradeId, deletedAt: null } })
    : db.note.findFirst({ where: { kind: "DAILY", day: new Date(`${t.day}T00:00:00Z`), deletedAt: null } });
}

export async function loadNote(target: z.input<typeof noteTarget>): Promise<NoteDTO> {
  await requireSession();
  const t = noteTarget.parse(target);
  const [note, tpl] = await Promise.all([findNote(t), db.noteTemplate.findFirst({ where: { kind: t.kind, isDefault: true } })]);
  return { id: note?.id ?? null, content: note?.content ?? null, template: tpl?.content ?? null, updatedAt: note?.updatedAt.toISOString() ?? null };
}

export async function saveNote(target: z.input<typeof noteTarget>, contentJson: string, plainText: string): Promise<Ok<{ id: string; updatedAt: string }>> {
  await requireSession();
  const t = noteTarget.parse(target);
  const parsed = parseNoteDoc(contentJson);
  if (!parsed.ok) return fail(parsed.error);
  const content = parsed.doc;
  const text = plainText.slice(0, 200_000);
  const existing = await findNote(t);
  const data = { content: content as object, plainText: text };
  const saved = existing
    ? await db.note.update({ where: { id: existing.id }, data })
    : await db.note.create({
        data: t.kind === "TRADE"
          ? { kind: "TRADE", tradeId: t.tradeId, title: "Trade note", ...data }
          : { kind: "DAILY", day: new Date(`${t.day}T00:00:00Z`), title: `Daily journal · ${t.day}`, ...data },
      });
  return { ok: true, id: saved.id, updatedAt: saved.updatedAt.toISOString() };
}

/** Open (creating if needed) the daily journal for a given day. */
export async function openDayNote(day: string) {
  await requireSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) redirect("/trades");
  const date = new Date(`${day}T00:00:00Z`);
  const existing = await db.note.findFirst({ where: { kind: "DAILY", day: date, deletedAt: null } });
  const note =
    existing ??
    (await db.note.create({ data: { kind: "DAILY", day: date, title: `Daily journal · ${day}`, content: { type: "doc", content: [{ type: "paragraph" }] }, plainText: "" } }));
  redirect(`/notebook?note=${note.id}`);
}


/** Ids of every trade matching the current filters, for "select all N matching" before a bulk action. */
export async function matchingTradeIds(params: Record<string, string>): Promise<string[]> {
  await requireSession();
  const { parseFilters } = await import("@/lib/filters/params");
  const { matchingIds } = await import("@/lib/queries/trade-list");
  return matchingIds(parseFilters(params));
}
