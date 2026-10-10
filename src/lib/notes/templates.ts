import type { NoteKind, Prisma, PrismaClient } from "@prisma/client";

type Node = Record<string, unknown>;
const text = (t: string): Node => ({ type: "text", text: t });
const para = (t = ""): Node => (t ? { type: "paragraph", content: [text(t)] } : { type: "paragraph" });
const heading = (t: string, level = 3): Node => ({ type: "heading", attrs: { level }, content: [text(t)] });
const task = (t: string): Node => ({ type: "taskItem", attrs: { checked: false }, content: [para(t)] });
const tasks = (items: string[]): Node => ({ type: "taskList", content: items.map(task) });
const bullets = (items: string[]): Node => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [para(t)] })) });
const doc = (...content: Node[]) => ({ type: "doc", content });

export interface TemplateDef {
  name: string;
  kind: NoteKind;
  isDefault: boolean;
  content: ReturnType<typeof doc>;
}

/** Templates every journal starts with. Created on first use and never overwritten, so edits stay. */
export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: "Trade review",
    kind: "TRADE",
    isDefault: true,
    content: doc(heading("Why did you take this trade?"), para(), heading("Did you follow your rules?"), para(), heading("Emotions, chart patterns, trade-management lessons"), para()),
  },
  {
    name: "Daily journal",
    kind: "DAILY",
    isDefault: true,
    content: doc(
      heading("Pre-market checklist", 2),
      tasks(["Bias for the day set (HTF structure)", "Key levels / areas marked", "High-impact news checked", "Max loss for the day decided", "Mental state: calm and ready to follow the plan"]),
      heading("Plan for today", 2),
      para(),
      heading("End-of-day review", 2),
      bullets(["What went well", "What to improve", "Rules I broke", "One lesson for tomorrow"]),
    ),
  },
  {
    name: "Session recap",
    kind: "SESSION_RECAP",
    isDefault: true,
    content: doc(heading("Session"), para(), heading("Setups taken"), para(), heading("What worked"), para(), heading("What did not"), para(), heading("Next session"), para()),
  },
  {
    name: "Weekly review",
    kind: "FREE",
    isDefault: false,
    content: doc(heading("Week in numbers", 2), para(), heading("Best decision this week", 3), para(), heading("Biggest mistake", 3), para(), heading("Pattern I keep repeating", 3), para(), heading("One thing to change next week", 3), para()),
  },
];

/** Make sure the default templates exist (by name). Idempotent; safe to call on every notebook load. */
export async function ensureDefaultTemplates(db: PrismaClient): Promise<void> {
  const have = new Set((await db.noteTemplate.findMany({ select: { name: true } })).map((t) => t.name));
  for (const t of DEFAULT_TEMPLATES) {
    if (!have.has(t.name)) await db.noteTemplate.create({ data: { ...t, content: t.content as unknown as Prisma.InputJsonValue } });
  }
}
