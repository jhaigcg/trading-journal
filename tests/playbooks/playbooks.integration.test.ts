/**
 * Playbooks against the real database (session and Next cache stubbed). Everything created is prefixed "TEST-" and
 * removed afterwards; the demo account is excluded from the numbers by filtering on the throwaway account.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: async () => ({ uid: "test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  addGroup,
  addRule,
  createPlaybook,
  deleteGroup,
  deleteMissedTrade,
  deleteRule,
  logMissedTrade,
  moveGroup,
  moveRule,
  newPlaybookNote,
  removeCover,
  renameGroup,
  updatePlaybook,
  updateRule,
  uploadCover,
} from "@/app/(app)/playbooks/actions";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters/params";
import { PLAYBOOK_TEMPLATES } from "@/lib/playbooks/templates";
import { highlights, listPlaybooks, loadPlaybook } from "@/lib/queries/playbooks";

const P = "TEST-";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let reachable = false;
let accountId = "";
const F = (extra: Record<string, string> = {}) => parseFilters({ account: accountId, range: "all", ...extra });

async function strategy(label: string, extra: Record<string, unknown> = {}) {
  return db.strategy.create({ data: { name: `${P}${label}`, groups: { create: [{ name: "Entry", position: 0, rules: { create: [{ text: "rule A", position: 0 }, { text: "rule B", position: 1 }] } }] }, ...extra }, include: { groups: { include: { rules: { orderBy: { position: "asc" } } } } } });
}
let seq = 0;
async function trade(strategyId: string, net: number, side: "LONG" | "SHORT" = "LONG", dayOffset = 0) {
  const i = ++seq;
  const day = new Date(Date.UTC(2032, 2, 1 + dayOffset));
  return db.trade.create({
    data: {
      accountId, strategyId, brokerTicket: `pb-${i}`, symbol: "XAUUSD", side, status: "CLOSED",
      openedAt: new Date(Date.UTC(2032, 2, 1 + dayOffset, 8, i % 50)), closedAt: new Date(Date.UTC(2032, 2, 1 + dayOffset, 8, (i % 50) + 5)),
      openDay: day, closeDay: day, holdSeconds: 300, quantity: 0.1, avgEntry: 2000, avgExit: 2001, grossPnl: net, netPnl: net, result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN",
    },
  });
}

beforeAll(async () => {
  try {
    await db.$queryRaw`select 1`;
    reachable = true;
    accountId = (await db.account.create({ data: { name: `${P}playbooks`, platform: "MANUAL", currency: "AUD", startingBalance: 0, syncType: "MANUAL" } })).id;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await db.note.deleteMany({ where: { strategy: { name: { startsWith: P } } } });
    await db.account.deleteMany({ where: { name: { startsWith: P } } });
    await db.strategy.deleteMany({ where: { name: { startsWith: P } } });
    await rm(path.resolve(process.cwd(), ".data", "uploads", "covers"), { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  }
  await db.$disconnect();
});

describe("playbook table and highlight cards", () => {
  it("per-playbook numbers match an independent calculation; highlights pick the right ones", async (ctx) => {
    if (!reachable) return ctx.skip();
    const a = await strategy("A (net winner)");
    const b = await strategy("B (loser)");
    const c = await strategy("C (steady)");
    const d = await strategy("D (retired)", { archived: true });
    const e = await strategy("E (idle)");
    for (const n of [100, 50, -30, -20]) await trade(a.id, n);
    for (const n of [-40, -60]) await trade(b.id, n);
    for (const n of [10, 10, 10, 10, 10, -5]) await trade(c.id, n);
    for (const n of [900, 900]) await trade(d.id, n); // archived: must not win a highlight
    await db.missedTrade.createMany({ data: [{ strategyId: a.id, seenAt: new Date() }, { strategyId: a.id, seenAt: new Date() }] });

    const rows = await listPlaybooks(F());
    const row = (s: { id: string }) => rows.find((r) => r.id === s.id)!;

    const A = row(a).summary;
    expect(A).toMatchObject({ count: 4, wins: 2, losses: 2, netPnl: 100, avgWin: 75, avgLoss: -25 });
    expect(A.profitFactor).toBeCloseTo(3, 9);
    expect(A.winRate).toBeCloseTo(0.5, 9);
    expect(A.expectancy).toBeCloseTo(25, 6); // 0.5 × 75 − 0.5 × 25
    expect(A.avgHoldSeconds).toBe(300);
    expect(row(a).missed).toBe(2);
    expect(row(b).summary).toMatchObject({ count: 2, netPnl: -100, wins: 0, losses: 2 });
    expect(row(b).summary.profitFactor).toBe(0);
    expect(row(c).summary.winRate).toBeCloseTo(5 / 6, 9);
    expect(row(e).summary.count).toBe(0);
    expect(row(e).summary.profitFactor).toBeNull();

    const h = highlights(rows);
    expect(h.best?.id).toBe(a.id); // D has more profit but is archived
    expect(h.worst?.id).toBe(b.id);
    expect(h.mostActive?.id).toBe(c.id);
    expect(h.bestWinRate?.id).toBe(c.id); // needs 5+ decided trades: A and B are too small or worse
  });

  it("a lone playbook is not both best and worst; tiny samples do not win 'best win rate'", () => {
    const mk = (id: string, net: number, wins: number, losses: number) => ({ id, name: id, color: "#fff", archived: false, coverUrl: null, description: null, missed: 0, summary: { count: wins + losses, wins, losses, netPnl: net, winRate: wins / Math.max(1, wins + losses) } }) as never;
    const one = highlights([mk("only", 50, 1, 0)]);
    expect(one.best?.id).toBe("only");
    expect(one.worst).toBeNull();
    expect(one.bestWinRate).toBeNull(); // 1 trade is not a win rate
    expect(highlights([])).toEqual({ best: null, worst: null, mostActive: null, bestWinRate: null });
  });

  it("the global filters change the numbers", async (ctx) => {
    if (!reachable) return ctx.skip();
    const s = await strategy("F (filters)");
    await trade(s.id, 100, "LONG", 10);
    await trade(s.id, -40, "SHORT", 10);
    await trade(s.id, 60, "SHORT", 12);
    const get = async (extra: Record<string, string>) => (await listPlaybooks(F(extra))).find((r) => r.id === s.id)!.summary;
    expect(await get({})).toMatchObject({ count: 3, netPnl: 120 });
    expect(await get({ side: "SHORT" })).toMatchObject({ count: 2, netPnl: 20 });
    expect(await get({ range: "custom", from: "2032-03-13", to: "2032-03-13" })).toMatchObject({ count: 1, netPnl: 60 });
    expect(await get({ result: "LOSS" })).toMatchObject({ count: 1, netPnl: -40 });
    const only = await listPlaybooks(F({ strategy: s.id }));
    expect(only.map((r) => r.id)).toEqual([s.id]); // the playbook picker narrows the table
  });
});

describe("playbook detail", () => {
  it("rule compliance, daily win rate, curve and lists", async (ctx) => {
    if (!reachable) return ctx.skip();
    const s = await strategy("G (detail)");
    const [ra, rb] = s.groups[0].rules;
    const t1 = await trade(s.id, 100, "LONG", 20);
    const t2 = await trade(s.id, -50, "LONG", 21);
    const t3 = await trade(s.id, 30, "LONG", 21);
    await db.tradeRuleCheck.createMany({ data: [
      { tradeId: t1.id, ruleId: ra.id, followed: true }, { tradeId: t2.id, ruleId: ra.id, followed: false }, { tradeId: t3.id, ruleId: ra.id, followed: true },
      { tradeId: t1.id, ruleId: rb.id, followed: true },
    ] });
    await db.note.create({ data: { kind: "FREE", title: `${P}about G`, strategyId: s.id, content: { type: "doc" }, plainText: "" } });
    await db.missedTrade.create({ data: { strategyId: s.id, seenAt: new Date("2032-03-21T08:00:00Z"), symbol: "XAUUSD", side: "SHORT", hypotheticalR: 2.5, reason: "hesitated" } });

    const d = (await loadPlaybook(s.id, F()))!;
    expect(d.summary).toMatchObject({ count: 3, netPnl: 80, wins: 2, losses: 1 });
    expect(d.groups[0].rules.map((r) => [r.text, r.followed, r.answered])).toEqual([["rule A", 2, 3], ["rule B", 1, 1]]);
    expect(d.compliance).toBeCloseTo((3 / 4) * 100, 6);
    expect(d.days).toMatchObject({ days: 2, green: 1, red: 1 }); // the 21st nets -50 + 30 = -20 → red
    expect(d.curve.map((p) => p.value)).toEqual([100, 80]);
    expect(d.recentTrades).toHaveLength(3);
    expect(d.notes.map((n) => n.title)).toEqual([`${P}about G`]);
    expect(d.missed[0]).toMatchObject({ symbol: "XAUUSD", side: "SHORT", hypotheticalR: 2.5, reason: "hesitated" });
    expect(await loadPlaybook("missing", F())).toBeNull();

    // compliance respects the filters: only the first day
    const day1 = (await loadPlaybook(s.id, F({ range: "custom", from: "2032-03-21", to: "2032-03-21" })))!;
    expect(day1.groups[0].rules[0]).toMatchObject({ followed: 1, answered: 1 });
  });
});

describe("creating and editing playbooks", () => {
  it("from a template, blank, and with validation", async (ctx) => {
    if (!reachable) return ctx.skip();
    const tpl = PLAYBOOK_TEMPLATES[3];
    const a = await createPlaybook({ name: `${P}from template`, templateKey: tpl.key });
    if (!a.ok) throw new Error(a.error);
    const full = await db.strategy.findUniqueOrThrow({ where: { id: a.id }, include: { groups: { orderBy: { position: "asc" }, include: { rules: { orderBy: { position: "asc" } } } } } });
    expect(full.color).toBe(tpl.color);
    expect(full.groups.map((g) => g.name)).toEqual(tpl.groups.map((g) => g.name));
    expect(full.groups.flatMap((g) => g.rules.map((r) => r.text))).toEqual(tpl.groups.flatMap((g) => g.rules));

    const blank = await createPlaybook({ name: `${P}blank` });
    expect(blank.ok && (await db.ruleGroup.count({ where: { strategyId: blank.id } }))).toBe(0);
    expect(await createPlaybook({ name: "   " })).toMatchObject({ ok: false });
    expect(await createPlaybook({ name: `${P}x`, templateKey: "nope" })).toMatchObject({ ok: false });
    expect(PLAYBOOK_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PLAYBOOK_TEMPLATES.map((t) => t.key)).size).toBe(PLAYBOOK_TEMPLATES.length);

    if (!blank.ok) return;
    expect(await updatePlaybook(blank.id, { name: `${P}renamed`, description: "  my notes  ", color: "#112233", archived: true })).toEqual({ ok: true });
    const u = await db.strategy.findUniqueOrThrow({ where: { id: blank.id } });
    expect(u).toMatchObject({ name: `${P}renamed`, description: "my notes", color: "#112233", archived: true });
    expect(await updatePlaybook(blank.id, { color: "red" })).toMatchObject({ ok: false });
    expect(await updatePlaybook(blank.id, { name: "" })).toMatchObject({ ok: false });
    expect(await updatePlaybook("missing", { archived: false })).toMatchObject({ ok: false });
  });

  it("rule groups and rules: add, edit, reorder, delete (deleting removes past answers)", async (ctx) => {
    if (!reachable) return ctx.skip();
    const s = await strategy("H (rules)");
    const g1 = s.groups[0];
    const g2 = await addGroup(s.id, "Management");
    if (!g2.ok) throw new Error(g2.error);
    expect(await addGroup(s.id, " ")).toMatchObject({ ok: false });
    expect(await addGroup("missing", "x")).toMatchObject({ ok: false });
    expect(await renameGroup(g2.id, "Risk")).toEqual({ ok: true });
    const names = async () => (await db.ruleGroup.findMany({ where: { strategyId: s.id }, orderBy: { position: "asc" } })).map((g) => g.name);
    expect(await names()).toEqual(["Entry", "Risk"]);
    await moveGroup(g2.id, -1);
    expect(await names()).toEqual(["Risk", "Entry"]);
    await moveGroup(g2.id, -1); // already first: no-op
    expect(await names()).toEqual(["Risk", "Entry"]);

    const r3 = await addRule(g1.id, "rule C");
    if (!r3.ok) throw new Error(r3.error);
    expect(await addRule(g1.id, "")).toMatchObject({ ok: false });
    expect(await addRule("missing", "x")).toMatchObject({ ok: false });
    const texts = async () => (await db.strategyRule.findMany({ where: { groupId: g1.id }, orderBy: { position: "asc" } })).map((r) => r.text);
    expect(await texts()).toEqual(["rule A", "rule B", "rule C"]);
    await moveRule(r3.id, -1);
    expect(await texts()).toEqual(["rule A", "rule C", "rule B"]);
    await moveRule(r3.id, 1);
    await moveRule(r3.id, 1); // last: no-op
    expect(await texts()).toEqual(["rule A", "rule B", "rule C"]);
    expect(await updateRule(r3.id, "  rule C (edited)  ")).toEqual({ ok: true });
    expect((await texts())[2]).toBe("rule C (edited)");

    const t = await trade(s.id, 10, "LONG", 30);
    await db.tradeRuleCheck.create({ data: { tradeId: t.id, ruleId: r3.id, followed: true } });
    expect(await deleteRule(r3.id)).toEqual({ ok: true });
    expect(await db.tradeRuleCheck.count({ where: { ruleId: r3.id } })).toBe(0);
    expect(await deleteRule(r3.id)).toMatchObject({ ok: false });
    expect(await deleteGroup(g1.id)).toEqual({ ok: true });
    expect(await db.strategyRule.count({ where: { groupId: g1.id } })).toBe(0);
    expect(await db.trade.findUnique({ where: { id: t.id } })).not.toBeNull(); // the trade itself is untouched
  });

  it("missed trades are logged and removed; notes link to the playbook", async (ctx) => {
    if (!reachable) return ctx.skip();
    const s = await strategy("I (missed)");
    const m = await logMissedTrade(s.id, { symbol: " xauusd ", seenAt: "2032-03-02T09:30:00Z", side: "LONG", hypotheticalR: 3, reason: "  was in a meeting  " });
    if (!m.ok) throw new Error(m.error);
    const row = await db.missedTrade.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ symbol: "XAUUSD", side: "LONG", reason: "was in a meeting" });
    expect(Number(row.hypotheticalR)).toBe(3);
    expect(await logMissedTrade(s.id, { seenAt: "garbage" })).toMatchObject({ ok: false });
    expect(await logMissedTrade(s.id, { seenAt: "2032-03-02T09:30:00Z", hypotheticalR: 999 })).toMatchObject({ ok: false });
    expect(await logMissedTrade("missing", { seenAt: "2032-03-02T09:30:00Z" })).toMatchObject({ ok: false });
    expect(await deleteMissedTrade(m.id)).toEqual({ ok: true });
    expect(await deleteMissedTrade(m.id)).toMatchObject({ ok: false });

    const n = await newPlaybookNote(s.id);
    if (!n.ok) throw new Error(n.error);
    expect(await db.note.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ strategyId: s.id, kind: "FREE" });
    expect(await newPlaybookNote("missing")).toMatchObject({ ok: false });
  });

  it("cover images: real images only, replacing deletes the old file, removing clears it", async (ctx) => {
    if (!reachable) return ctx.skip();
    const s = await strategy("J (cover)");
    const form = (bytes: Buffer, type: string) => {
      const f = new FormData();
      f.set("file", new File([new Uint8Array(bytes)], "c", { type }));
      return f;
    };
    expect(await uploadCover(s.id, form(PNG, "image/png"))).toEqual({ ok: true });
    const first = (await db.strategy.findUniqueOrThrow({ where: { id: s.id } })).coverUrl!;
    expect(first).toMatch(/^covers\/.+\.png$/);
    const abs = (k: string) => path.resolve(process.cwd(), ".data", "uploads", k);
    expect(existsSync(abs(first))).toBe(true);

    expect(await uploadCover(s.id, form(Buffer.from("<svg onload=alert(1)>"), "image/svg+xml"))).toMatchObject({ ok: false });
    expect(await uploadCover(s.id, form(Buffer.from("not an image"), "image/png"))).toMatchObject({ ok: false });
    expect(await uploadCover("missing", form(PNG, "image/png"))).toMatchObject({ ok: false });

    expect(await uploadCover(s.id, form(PNG, "image/png"))).toEqual({ ok: true });
    const second = (await db.strategy.findUniqueOrThrow({ where: { id: s.id } })).coverUrl!;
    expect(second).not.toBe(first);
    expect(existsSync(abs(first))).toBe(false); // old file cleaned up
    expect(existsSync(abs(second))).toBe(true);

    expect(await removeCover(s.id)).toEqual({ ok: true });
    expect((await db.strategy.findUniqueOrThrow({ where: { id: s.id } })).coverUrl).toBeNull();
    expect(existsSync(abs(second))).toBe(false);
  });
});
