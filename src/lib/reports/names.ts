import { loadFilterOptions } from "@/lib/queries/options";
import type { Names } from "./describe";

/** Account, playbook and tag names for describing filters in words. */
export async function loadNames(): Promise<Names> {
  const o = await loadFilterOptions();
  return {
    accounts: Object.fromEntries(o.accounts.map((a) => [a.id, a.name])),
    strategies: Object.fromEntries(o.strategies.map((s) => [s.id, s.name])),
    tags: Object.fromEntries(o.tagGroups.flatMap((g) => g.tags.map((t) => [t.id, t.name]))),
  };
}
