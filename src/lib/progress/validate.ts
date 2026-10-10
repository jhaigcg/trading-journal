import { z } from "zod";
import { PERCENT_FIELDS, RULE_KINDS, parseTime } from "./evaluate";

const base = z.object({ name: z.string().trim().min(1, "Give the rule a name.").max(120) });

const input = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("TIME_BY"), time: z.string().refine((s) => parseTime(s) != null, "Use a time like 09:30.") }),
  base.extend({ kind: z.literal("PERCENT_WITH_FIELD"), field: z.enum(PERCENT_FIELDS), percent: z.coerce.number().min(1, "Use 1 to 100.").max(100, "Use 1 to 100.") }),
  base.extend({ kind: z.literal("MAX_LOSS_PER_TRADE"), amount: z.coerce.number().positive("Enter an amount above 0.").max(10_000_000) }),
  base.extend({ kind: z.literal("MAX_LOSS_PER_DAY"), amount: z.coerce.number().positive("Enter an amount above 0.").max(10_000_000) }),
  base.extend({ kind: z.literal("MANUAL_CHECK") }),
]);

export interface RuleInput {
  name: string;
  kind: (typeof RULE_KINDS)[number];
  params: Record<string, unknown>;
}

/** Turn the form values into what is stored: a name, a kind and its parameters. */
export function parseRuleInput(raw: unknown): { ok: true; value: RuleInput } | { ok: false; error: string } {
  const r = input.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Check the rule and try again." };
  const v = r.data;
  switch (v.kind) {
    case "TIME_BY":
      return { ok: true, value: { name: v.name, kind: v.kind, params: { time: String(parseTime(v.time) !== null ? v.time.padStart(5, "0") : v.time) } } };
    case "PERCENT_WITH_FIELD":
      return { ok: true, value: { name: v.name, kind: v.kind, params: { field: v.field, percent: v.percent } } };
    case "MAX_LOSS_PER_TRADE":
    case "MAX_LOSS_PER_DAY":
      return { ok: true, value: { name: v.name, kind: v.kind, params: { amount: v.amount } } };
    case "MANUAL_CHECK":
      return { ok: true, value: { name: v.name, kind: v.kind, params: {} } };
  }
}

/** Starter set from the brief: the five example rules. */
export const STARTER_RULES: RuleInput[] = [
  { name: "Start my day by 09:30", kind: "TIME_BY", params: { time: "09:30" } },
  { name: "Link every trade to a playbook", kind: "PERCENT_WITH_FIELD", params: { field: "strategyId", percent: 100 } },
  { name: "Stop loss on all trades", kind: "PERCENT_WITH_FIELD", params: { field: "stopLoss", percent: 100 } },
  { name: "Max net loss per trade A$100", kind: "MAX_LOSS_PER_TRADE", params: { amount: 100 } },
  { name: "Max net loss per day A$100", kind: "MAX_LOSS_PER_DAY", params: { amount: 100 } },
];

export const parseWeekdays = (raw: unknown): number[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const days = raw.map(Number);
  if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || new Set(days).size !== days.length) return null;
  return days.sort((a, b) => a - b);
};
