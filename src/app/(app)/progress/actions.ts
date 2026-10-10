"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { STARTER_RULES, parseRuleInput, parseWeekdays } from "@/lib/progress/validate";
import { getSession } from "@/lib/session";
import { DEFAULT_TZ, dayKey } from "@/lib/time";

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}
const refresh = () => revalidatePath("/progress");

/** Create or update a rule. `raw` is a JSON string (nested values do not survive server-action decoding reliably). */
export async function saveRule(id: string | null, raw: string): Promise<Result> {
  await requireSession();
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail("Could not read the rule.");
  }
  const parsed = parseRuleInput(input);
  if (!parsed.ok) return fail(parsed.error);
  const { name, kind, params } = parsed.value;
  if (id) {
    const found = await db.disciplineRule.findUnique({ where: { id }, select: { id: true } });
    if (!found) return fail("That rule no longer exists.");
    await db.disciplineRule.update({ where: { id }, data: { name, kind, params: params as object } });
  } else {
    const last = await db.disciplineRule.aggregate({ _max: { position: true } });
    await db.disciplineRule.create({ data: { name, kind, params: params as object, position: (last._max.position ?? -1) + 1 } });
  }
  refresh();
  return { ok: true };
}

export async function setRuleActive(id: string, active: boolean): Promise<Result> {
  await requireSession();
  const r = await db.disciplineRule.updateMany({ where: { id }, data: { active } });
  if (!r.count) return fail("That rule no longer exists.");
  refresh();
  return { ok: true };
}

export async function deleteRule(id: string): Promise<Result> {
  await requireSession();
  await db.disciplineRule.deleteMany({ where: { id } });
  refresh();
  return { ok: true };
}

/** Tick or untick a manual rule for one day (not in the future). */
export async function setManual(ruleId: string, day: string, followed: boolean): Promise<Result> {
  await requireSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail("Invalid day.");
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  if (day > dayKey(new Date(), settings?.displayTimezone ?? DEFAULT_TZ)) return fail("You cannot tick a day that has not happened yet.");
  const rule = await db.disciplineRule.findUnique({ where: { id: ruleId }, select: { kind: true } });
  if (!rule || rule.kind !== "MANUAL_CHECK") return fail("That is not a manual rule.");
  const date = new Date(`${day}T00:00:00Z`);
  await db.disciplineLog.upsert({ where: { ruleId_day: { ruleId, day: date } }, update: { followed, auto: false }, create: { ruleId, day: date, followed, auto: false } });
  refresh();
  return { ok: true };
}

/** Which weekdays count as trading days (0 = Sunday … 6 = Saturday), as a JSON array string. */
export async function setTradingDays(raw: string): Promise<Result> {
  await requireSession();
  let days: unknown;
  try {
    days = JSON.parse(raw);
  } catch {
    return fail("Could not read the days.");
  }
  const ok = parseWeekdays(days);
  if (!ok) return fail("Pick at least one trading day.");
  await db.setting.upsert({ where: { id: 1 }, update: { tradingDays: ok }, create: { id: 1, tradingDays: ok } });
  refresh();
  return { ok: true };
}

/** Add the five example rules from the brief (only when there are no rules yet). */
export async function addStarterRules(): Promise<Result> {
  await requireSession();
  if ((await db.disciplineRule.count()) > 0) return fail("You already have rules.");
  await db.disciplineRule.createMany({ data: STARTER_RULES.map((r, position) => ({ name: r.name, kind: r.kind, params: r.params as object, position })) });
  refresh();
  return { ok: true };
}
