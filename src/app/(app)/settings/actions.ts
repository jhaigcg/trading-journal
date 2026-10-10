"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyDisplaySettings, changePassword, type Result } from "@/lib/settings/apply";
import * as catalog from "@/lib/settings/catalog";
import { getSession } from "@/lib/session";

async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
/** Every analytics page reads these settings, so refresh them all. */
const everywhere = () => revalidatePath("/", "layout");
const done = <T extends Result<object>>(r: T): T => {
  if (r.ok) everywhere();
  return r;
};

export async function saveDisplay(timezone: string, currency: string, threshold: string) {
  await requireSession();
  return done(await applyDisplaySettings({ timezone, currency, threshold }));
}

export async function savePassword(current: string, next: string, confirm: string) {
  const s = await requireSession();
  return changePassword(s.uid, { current, next, confirm });
}

export async function addCategory(name: string) {
  await requireSession();
  return done(await catalog.createCategory(name));
}
export async function editCategory(id: string, name: string) {
  await requireSession();
  return done(await catalog.renameCategory(id, name));
}
export async function removeCategory(id: string) {
  await requireSession();
  return done(await catalog.deleteCategory(id));
}
export async function addTag(categoryId: string, name: string) {
  await requireSession();
  return done(await catalog.createTag(categoryId, name));
}
export async function editTag(id: string, name: string) {
  await requireSession();
  return done(await catalog.renameTag(id, name));
}
export async function removeTag(id: string) {
  await requireSession();
  return done(await catalog.deleteTag(id));
}

export async function addRate(base: string, quote: string, rate: string) {
  await requireSession();
  return done(await catalog.saveRate({ base, quote, rate }));
}
export async function removeRate(base: string, quote: string) {
  await requireSession();
  return done(await catalog.deleteRate(base, quote));
}

export async function editSymbol(symbol: string, pipSize: string, contractSize: string) {
  await requireSession();
  return done(await catalog.saveSymbol({ symbol, pipSize, contractSize }));
}
