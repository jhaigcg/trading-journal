"use server";

import { isRealDay } from "@/lib/day";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DEFAULT_TZ, dayKey } from "@/lib/time";

const item = (text: string) => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const CHECKLIST = ["Bias for the day set (HTF structure)", "Key levels / areas marked", "High-impact news checked", "Max loss for the day decided", "Mental state: calm and ready to follow the plan"];

/**
 * "Start my day": opens today's daily journal, creating it with a pre-market checklist the first time.
 * The moment it is first opened is recorded (startedAt) and feeds the "start my day by HH:MM" discipline rule.
 */
export async function startMyDay() {
  if (!(await getSession())) redirect("/login");
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  const day = dayKey(new Date(), settings?.displayTimezone ?? DEFAULT_TZ);
  const date = new Date(`${day}T00:00:00Z`);

  let note = await db.note.findFirst({ where: { kind: "DAILY", day: date, deletedAt: null } });
  if (!note) {
    note = await db.note.create({
      data: {
        kind: "DAILY",
        day: date,
        title: `Daily journal · ${day}`,
        plainText: CHECKLIST.join("\n"),
        content: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Pre-market checklist" }] },
            { type: "taskList", content: CHECKLIST.map(item) },
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan for today" }] },
            { type: "paragraph" },
          ],
        },
        startedAt: new Date(),
      },
    });
  } else if (!note.startedAt) {
    note = await db.note.update({ where: { id: note.id }, data: { startedAt: new Date() } });
  }
  redirect(`/notebook?note=${note.id}`);
}

/** Open the daily journal for any past or present day, creating an empty one the first time. (Does not count as "Start my day".) */
export async function openDayJournal(day: string) {
  if (!(await getSession())) redirect("/login");
  if (!isRealDay(day)) redirect("/notebook");
  const date = new Date(`${day}T00:00:00Z`);
  const note =
    (await db.note.findFirst({ where: { kind: "DAILY", day: date, deletedAt: null } })) ??
    (await db.note.create({ data: { kind: "DAILY", day: date, title: `Daily journal · ${day}`, plainText: "", content: { type: "doc", content: [{ type: "paragraph" }] } } }));
  redirect(`/notebook?note=${note.id}`);
}
