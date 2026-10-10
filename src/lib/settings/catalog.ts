import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Result } from "./apply";
import { firstError, rateSchema, symbolSchema, tagNameSchema } from "./validate";

/** Run a write; a unique-constraint clash becomes a friendly message instead of an error page. */
async function guarded<T extends object>(fn: () => Promise<T>, duplicate: string): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return { ok: false, error: duplicate };
      if (e.code === "P2025") return { ok: false, error: "That item no longer exists. Refresh the page." };
    }
    throw e;
  }
}

const name = (raw: unknown) => tagNameSchema.safeParse(raw);

// ───────────── tags ─────────────

export async function createCategory(raw: unknown): Promise<Result<{ id: string }>> {
  const n = name(raw);
  if (!n.success) return { ok: false, error: firstError(n.error) };
  const last = await db.tagCategory.aggregate({ _max: { position: true } });
  return guarded(async () => ({ id: (await db.tagCategory.create({ data: { name: n.data, position: (last._max.position ?? -1) + 1 } })).id }), "You already have a group with that name.");
}

export async function renameCategory(id: string, raw: unknown): Promise<Result> {
  const n = name(raw);
  if (!n.success) return { ok: false, error: firstError(n.error) };
  return guarded(async () => (await db.tagCategory.update({ where: { id }, data: { name: n.data } }), {}), "You already have a group with that name.");
}

/** Deleting a group deletes its tags and removes them from every trade and note. Returns how many trades were affected. */
export async function deleteCategory(id: string): Promise<Result<{ trades: number }>> {
  const trades = await db.tradeTag.count({ where: { tag: { categoryId: id } } });
  return guarded(async () => (await db.tagCategory.delete({ where: { id } }), { trades }), "");
}

export async function createTag(categoryId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const n = name(raw);
  if (!n.success) return { ok: false, error: firstError(n.error) };
  if (!(await db.tagCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) return { ok: false, error: "That group no longer exists. Refresh the page." };
  return guarded(async () => ({ id: (await db.tag.create({ data: { categoryId, name: n.data } })).id }), "That tag already exists in this group.");
}

export async function renameTag(id: string, raw: unknown): Promise<Result> {
  const n = name(raw);
  if (!n.success) return { ok: false, error: firstError(n.error) };
  return guarded(async () => (await db.tag.update({ where: { id }, data: { name: n.data } }), {}), "That tag already exists in this group.");
}

export async function deleteTag(id: string): Promise<Result<{ trades: number }>> {
  const trades = await db.tradeTag.count({ where: { tagId: id } });
  return guarded(async () => (await db.tag.delete({ where: { id } }), { trades }), "");
}

// ───────────── currency rates ─────────────

export async function saveRate(raw: unknown): Promise<Result> {
  const p = rateSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const { base, quote, rate } = p.data;
  await db.fxRate.upsert({ where: { base_quote: { base, quote } }, update: { rate }, create: { base, quote, rate } });
  return { ok: true };
}

export async function deleteRate(base: string, quote: string): Promise<Result> {
  await db.fxRate.deleteMany({ where: { base, quote } });
  return { ok: true };
}

// ───────────── symbols ─────────────

/** Change the pip and contract size of a symbol. Trades already stored keep their saved pips; new and edited trades use the new sizes. */
export async function saveSymbol(raw: unknown): Promise<Result> {
  const p = symbolSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const { symbol, pipSize, contractSize } = p.data;
  const found = await db.symbolConfig.findUnique({ where: { symbol }, select: { symbol: true } });
  if (!found) return { ok: false, error: "That symbol is not in your list. Symbols are added automatically when you import trades." };
  await db.symbolConfig.update({ where: { symbol }, data: { pipSize, contractSize } });
  return { ok: true };
}
