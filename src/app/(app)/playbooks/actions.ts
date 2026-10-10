"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { PLAYBOOK_TEMPLATES } from "@/lib/playbooks/templates";
import { getSession } from "@/lib/session";
import { checkImage, deleteFile, putImage } from "@/lib/storage";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}
const refresh = (strategyId?: string) => {
  revalidatePath("/playbooks");
  if (strategyId) revalidatePath(`/playbooks/${strategyId}`);
};

const name = z.string().trim().min(1, "Give it a name.").max(120);
const ruleText = z.string().trim().min(1, "Write the rule.").max(300);

// ───────────── playbooks ─────────────

export async function createPlaybook(input: { name: string; templateKey?: string | null }): Promise<Ok<{ id: string }>> {
  await requireSession();
  const n = name.safeParse(input.name);
  if (!n.success) return fail(n.error.issues[0].message);
  const tpl = input.templateKey ? PLAYBOOK_TEMPLATES.find((t) => t.key === input.templateKey) : undefined;
  if (input.templateKey && !tpl) return fail("Unknown template.");

  const s = await db.strategy.create({
    data: {
      name: n.data,
      color: tpl?.color ?? "#E0B04E",
      description: tpl?.description ?? null,
      groups: tpl ? { create: tpl.groups.map((g, gi) => ({ name: g.name, position: gi, rules: { create: g.rules.map((text, ri) => ({ text, position: ri })) } })) } : undefined,
    },
  });
  refresh();
  return { ok: true, id: s.id };
}

const updateSchema = z.object({
  name: name.optional(),
  description: z.string().max(1000).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Choose a colour.").optional(),
  archived: z.boolean().optional(),
});

export async function updatePlaybook(strategyId: string, patch: z.input<typeof updateSchema>): Promise<Ok> {
  await requireSession();
  const p = updateSchema.safeParse(patch);
  if (!p.success) return fail(p.error.issues[0].message);
  const { description, ...rest } = p.data;
  const r = await db.strategy.updateMany({ where: { id: strategyId }, data: { ...rest, ...(description !== undefined ? { description: description.trim() || null } : {}) } });
  if (!r.count) return fail("Playbook not found.");
  refresh(strategyId);
  return { ok: true };
}

export async function uploadCover(strategyId: string, form: FormData): Promise<Ok> {
  await requireSession();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose an image first.");
  const s = await db.strategy.findUnique({ where: { id: strategyId }, select: { coverUrl: true } });
  if (!s) return fail("Playbook not found.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkImage(file.type, bytes);
  if (!check.ok) return fail(check.error);
  const key = await putImage(`covers/${strategyId}`, check.ext, bytes, file.type);
  await db.strategy.update({ where: { id: strategyId }, data: { coverUrl: key } });
  if (s.coverUrl) await deleteFile(s.coverUrl);
  refresh(strategyId);
  return { ok: true };
}

export async function removeCover(strategyId: string): Promise<Ok> {
  await requireSession();
  const s = await db.strategy.findUnique({ where: { id: strategyId }, select: { coverUrl: true } });
  if (!s) return fail("Playbook not found.");
  await db.strategy.update({ where: { id: strategyId }, data: { coverUrl: null } });
  if (s.coverUrl) await deleteFile(s.coverUrl);
  refresh(strategyId);
  return { ok: true };
}

// ───────────── rule groups and rules ─────────────

export async function addGroup(strategyId: string, groupName: string): Promise<Ok<{ id: string }>> {
  await requireSession();
  const n = name.safeParse(groupName);
  if (!n.success) return fail(n.error.issues[0].message);
  if (!(await db.strategy.findUnique({ where: { id: strategyId }, select: { id: true } }))) return fail("Playbook not found.");
  const last = await db.ruleGroup.aggregate({ where: { strategyId }, _max: { position: true } });
  const g = await db.ruleGroup.create({ data: { strategyId, name: n.data, position: (last._max.position ?? -1) + 1 } });
  refresh(strategyId);
  return { ok: true, id: g.id };
}

export async function renameGroup(groupId: string, groupName: string): Promise<Ok> {
  await requireSession();
  const n = name.safeParse(groupName);
  if (!n.success) return fail(n.error.issues[0].message);
  const g = await db.ruleGroup.update({ where: { id: groupId }, data: { name: n.data } }).catch(() => null);
  if (!g) return fail("Group not found.");
  refresh(g.strategyId);
  return { ok: true };
}

/** Deleting a group deletes its rules and every answer given to them on past trades. */
export async function deleteGroup(groupId: string): Promise<Ok> {
  await requireSession();
  const g = await db.ruleGroup.delete({ where: { id: groupId } }).catch(() => null);
  if (!g) return fail("Group not found.");
  refresh(g.strategyId);
  return { ok: true };
}

export async function addRule(groupId: string, text: string): Promise<Ok<{ id: string }>> {
  await requireSession();
  const t = ruleText.safeParse(text);
  if (!t.success) return fail(t.error.issues[0].message);
  const group = await db.ruleGroup.findUnique({ where: { id: groupId } });
  if (!group) return fail("Group not found.");
  const last = await db.strategyRule.aggregate({ where: { groupId }, _max: { position: true } });
  const r = await db.strategyRule.create({ data: { groupId, text: t.data, position: (last._max.position ?? -1) + 1 } });
  refresh(group.strategyId);
  return { ok: true, id: r.id };
}

export async function updateRule(ruleId: string, text: string): Promise<Ok> {
  await requireSession();
  const t = ruleText.safeParse(text);
  if (!t.success) return fail(t.error.issues[0].message);
  const r = await db.strategyRule.update({ where: { id: ruleId }, data: { text: t.data }, include: { group: true } }).catch(() => null);
  if (!r) return fail("Rule not found.");
  refresh(r.group.strategyId);
  return { ok: true };
}

export async function deleteRule(ruleId: string): Promise<Ok> {
  await requireSession();
  const r = await db.strategyRule.delete({ where: { id: ruleId }, include: { group: true } }).catch(() => null);
  if (!r) return fail("Rule not found.");
  refresh(r.group.strategyId);
  return { ok: true };
}

/** Swap with the neighbour above (-1) or below (+1). Positions are renumbered so ties can never leave the order ambiguous. */
export async function moveGroup(groupId: string, dir: -1 | 1): Promise<Ok> {
  await requireSession();
  const g = await db.ruleGroup.findUnique({ where: { id: groupId } });
  if (!g) return fail("Group not found.");
  const siblings = await db.ruleGroup.findMany({ where: { strategyId: g.strategyId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
  const order = reorder(siblings.map((s) => s.id), groupId, dir);
  await db.$transaction(order.map((gid, position) => db.ruleGroup.update({ where: { id: gid }, data: { position } })));
  refresh(g.strategyId);
  return { ok: true };
}

export async function moveRule(ruleId: string, dir: -1 | 1): Promise<Ok> {
  await requireSession();
  const r = await db.strategyRule.findUnique({ where: { id: ruleId }, include: { group: true } });
  if (!r) return fail("Rule not found.");
  const siblings = await db.strategyRule.findMany({ where: { groupId: r.groupId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
  const order = reorder(siblings.map((s) => s.id), ruleId, dir);
  await db.$transaction(order.map((rid, position) => db.strategyRule.update({ where: { id: rid }, data: { position } })));
  refresh(r.group.strategyId);
  return { ok: true };
}

function reorder(ids: string[], target: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(target);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// ───────────── missed trades ─────────────

const missedSchema = z.object({
  symbol: z.string().trim().toUpperCase().max(20).optional(),
  seenAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Enter the date and time you saw the setup."),
  side: z.enum(["LONG", "SHORT"]).nullish(),
  hypotheticalR: z.number().min(-20).max(50).nullish(),
  reason: z.string().trim().max(500).optional(),
});

/** A setup I saw but did not take. `seenAt` arrives as an ISO instant (the form converts from the display timezone). */
export async function logMissedTrade(strategyId: string, input: z.input<typeof missedSchema>): Promise<Ok<{ id: string }>> {
  await requireSession();
  const p = missedSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  if (!(await db.strategy.findUnique({ where: { id: strategyId }, select: { id: true } }))) return fail("Playbook not found.");
  const m = await db.missedTrade.create({
    data: { strategyId, symbol: p.data.symbol || null, seenAt: new Date(p.data.seenAt), side: p.data.side ?? null, hypotheticalR: p.data.hypotheticalR ?? null, reason: p.data.reason || null },
  });
  refresh(strategyId);
  return { ok: true, id: m.id };
}

export async function deleteMissedTrade(missedId: string): Promise<Ok> {
  await requireSession();
  const m = await db.missedTrade.delete({ where: { id: missedId } }).catch(() => null);
  if (!m) return fail("Not found.");
  refresh(m.strategyId);
  return { ok: true };
}

// ───────────── notes about a playbook ─────────────

export async function newPlaybookNote(strategyId: string): Promise<Ok<{ id: string }>> {
  await requireSession();
  const s = await db.strategy.findUnique({ where: { id: strategyId }, select: { name: true } });
  if (!s) return fail("Playbook not found.");
  const note = await db.note.create({ data: { kind: "FREE", title: `${s.name} · notes`, strategyId, content: { type: "doc", content: [{ type: "paragraph" }] }, plainText: "" } });
  revalidatePath("/notebook");
  refresh(strategyId);
  return { ok: true, id: note.id };
}
