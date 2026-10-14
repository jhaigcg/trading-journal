"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { deleteScenario, removeScenarioImage, saveScenario, setScenarioImage, type Result } from "@/lib/training/scenarios";

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}
const refresh = (id?: string) => {
  revalidatePath("/training");
  if (id) revalidatePath(`/training/${id}`);
};

/** Create or update a scenario. `raw` is a JSON string (nested values do not survive server-action decoding reliably). */
export async function saveScenarioAction(id: string | null, raw: string): Promise<Result<{ id: string }>> {
  await requireSession();
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Could not read the form." };
  }
  const r = await saveScenario(id, input);
  if (r.ok) refresh(r.id);
  return r;
}

export async function deleteScenarioAction(id: string): Promise<Result> {
  await requireSession();
  const r = await deleteScenario(id);
  refresh(id);
  return r;
}

export async function uploadScenarioImage(id: string, form: FormData): Promise<Result<{ url: string }>> {
  await requireSession();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image first." };
  const r = await setScenarioImage(id, { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
  if (r.ok) refresh(id);
  return r;
}

export async function removeScenarioImageAction(id: string): Promise<Result> {
  await requireSession();
  const r = await removeScenarioImage(id);
  refresh(id);
  return r;
}
