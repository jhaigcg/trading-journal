import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyDisplaySettings, changePassword } from "@/lib/settings/apply";
import { createCategory, createTag, deleteCategory, deleteRate, deleteTag, renameCategory, renameTag, saveRate, saveSymbol } from "@/lib/settings/catalog";
import { displaySchema, isValidTimezone, passwordSchema, rateSchema, symbolSchema } from "@/lib/settings/validate";

describe("validation", () => {
  it("timezones", () => {
    for (const ok of ["Asia/Hong_Kong", "UTC", "America/New_York", "America/Argentina/Buenos_Aires"]) expect(isValidTimezone(ok), ok).toBe(true);
    for (const bad of ["", "Nowhere/City", "hongkong", "Asia/Hong Kong", "'; drop table", "NYCLOSE"]) expect(isValidTimezone(bad), bad).toBe(false);
  });
  it("display settings", () => {
    expect(displaySchema.parse({ timezone: "UTC", currency: " aud ", threshold: "2.5" })).toEqual({ timezone: "UTC", currency: "AUD", threshold: 2.5 });
    expect(displaySchema.safeParse({ timezone: "UTC", currency: "AU", threshold: 0 }).success).toBe(false);
    expect(displaySchema.safeParse({ timezone: "UTC", currency: "AUD", threshold: -1 }).success).toBe(false);
    expect(displaySchema.safeParse({ timezone: "UTC", currency: "AUD", threshold: "abc" }).success).toBe(false);
  });
  it("rates need two different codes and a positive rate", () => {
    expect(rateSchema.safeParse({ base: "usd", quote: "aud", rate: "1.52" }).success).toBe(true);
    expect(rateSchema.safeParse({ base: "AUD", quote: "AUD", rate: 1 }).success).toBe(false);
    expect(rateSchema.safeParse({ base: "AUD", quote: "USD", rate: 0 }).success).toBe(false);
  });
  it("symbols", () => {
    expect(symbolSchema.parse({ symbol: "xauusd", pipSize: "0.1", contractSize: 100 })).toEqual({ symbol: "XAUUSD", pipSize: 0.1, contractSize: 100 });
    expect(symbolSchema.safeParse({ symbol: "x y", pipSize: 1, contractSize: 1 }).success).toBe(false);
    expect(symbolSchema.safeParse({ symbol: "XAUUSD", pipSize: 0, contractSize: 1 }).success).toBe(false);
  });
  it("passwords", () => {
    expect(passwordSchema.safeParse({ current: "a", next: "longenough1", confirm: "longenough1" }).success).toBe(true);
    expect(passwordSchema.safeParse({ current: "a", next: "short", confirm: "short" }).success).toBe(false);
    expect(passwordSchema.safeParse({ current: "a", next: "longenough1", confirm: "different11" }).success).toBe(false);
    expect(passwordSchema.safeParse({ current: "longenough1", next: "longenough1", confirm: "longenough1" }).success).toBe(false);
  });
});

const P = "TEST-settings";
let reachable = false;
let accountId = "";
let original = { displayTimezone: "Asia/Hong_Kong", displayCurrency: "AUD", breakevenThreshold: 0 };

beforeAll(async () => {
  try {
    const s = await db.setting.findUnique({ where: { id: 1 } });
    if (s) original = { displayTimezone: s.displayTimezone, displayCurrency: s.displayCurrency, breakevenThreshold: Number(s.breakevenThreshold) };
    accountId = (await db.account.create({ data: { name: `${P}-acc`, platform: "MANUAL", currency: "AUD", startingBalance: 0, syncType: "MANUAL" } })).id;
    reachable = true;
  } catch {
    reachable = false;
  }
});
afterAll(async () => {
  if (reachable) {
    await db.user.deleteMany({ where: { email: { startsWith: P } } });
    await db.tagCategory.deleteMany({ where: { name: { startsWith: P } } });
    await db.fxRate.deleteMany({ where: { base: "ZZZ" } });
    await db.account.deleteMany({ where: { name: { startsWith: P } } });
    await applyDisplaySettings({ timezone: original.displayTimezone, currency: original.displayCurrency, threshold: original.breakevenThreshold });
  }
  await db.$disconnect();
});

describe("display settings recompute what trades stored", () => {
  it("changing the timezone moves trading days; changing the threshold moves breakevens; summaries follow", async (ctx) => {
    if (!reachable) return ctx.skip();
    // 17:30 UTC on 5 May is 01:30 on 6 May in Hong Kong, but still 5 May in UTC and New York
    const open = new Date("2031-05-05T17:00:00Z");
    const close = new Date("2031-05-05T17:30:00Z");
    const t = await db.trade.create({
      data: { accountId, brokerTicket: `${P}-1`, symbol: "XAUUSD", side: "LONG", status: "CLOSED", openedAt: open, closedAt: close, openDay: new Date("2031-05-06T00:00:00Z"), closeDay: new Date("2031-05-06T00:00:00Z"), quantity: 0.1, avgEntry: 2000, avgExit: 2001, grossPnl: 3, netPnl: 3, result: "WIN" },
    });
    const get = () => db.trade.findUniqueOrThrow({ where: { id: t.id } });
    const day = (d: Date | null) => d?.toISOString().slice(0, 10);
    try {
      const r1 = await applyDisplaySettings({ timezone: "Asia/Hong_Kong", currency: "AUD", threshold: 0 });
      expect(r1.ok).toBe(true);
      expect(day((await get()).closeDay)).toBe("2031-05-06");
      expect((await get()).result).toBe("WIN");

      await applyDisplaySettings({ timezone: "UTC", currency: "AUD", threshold: 0 });
      let row = await get();
      expect(day(row.openDay)).toBe("2031-05-05");
      expect(day(row.closeDay)).toBe("2031-05-05");
      expect(row.intraday).toBe(true);
      expect(await db.dailySummary.findFirst({ where: { accountId, day: new Date("2031-05-05T00:00:00Z") } })).toMatchObject({ trades: 1, wins: 1 });
      expect(await db.dailySummary.count({ where: { accountId, day: new Date("2031-05-06T00:00:00Z") } })).toBe(0);

      // a $3 win is a breakeven once the threshold is $5
      await applyDisplaySettings({ timezone: "UTC", currency: "AUD", threshold: 5 });
      row = await get();
      expect(row.result).toBe("BREAKEVEN");
      expect(await db.dailySummary.findFirst({ where: { accountId, day: new Date("2031-05-05T00:00:00Z") } })).toMatchObject({ wins: 0, breakevens: 1 });

      // a trade that crosses midnight in the new timezone stops being intraday
      await applyDisplaySettings({ timezone: "Asia/Hong_Kong", currency: "AUD", threshold: 0 });
      await db.trade.update({ where: { id: t.id }, data: { openedAt: new Date("2031-05-05T15:30:00Z") } }); // 23:30 HK on the 5th, close 01:30 HK on the 6th
      await applyDisplaySettings({ timezone: "Asia/Hong_Kong", currency: "AUD", threshold: 0.01 });
      row = await get();
      expect(day(row.openDay)).toBe("2031-05-05");
      expect(day(row.closeDay)).toBe("2031-05-06");
      expect(row.intraday).toBe(false);
    } finally {
      await db.trade.delete({ where: { id: t.id } });
    }
  }, 60_000);

  it("saving the same values does not recompute, and bad values are refused without changing anything", async (ctx) => {
    if (!reachable) return ctx.skip();
    await applyDisplaySettings({ timezone: original.displayTimezone, currency: original.displayCurrency, threshold: original.breakevenThreshold });
    const same = await applyDisplaySettings({ timezone: original.displayTimezone, currency: original.displayCurrency, threshold: original.breakevenThreshold });
    expect(same).toMatchObject({ ok: true, recomputed: null });
    const bad = await applyDisplaySettings({ timezone: "Mars/Olympus", currency: "AUD", threshold: 0 });
    expect(bad.ok).toBe(false);
    expect((await db.setting.findUnique({ where: { id: 1 } }))?.displayTimezone).toBe(original.displayTimezone);
  });
});

describe("tags", () => {
  it("create, rename, duplicate protection and delete with counts", async (ctx) => {
    if (!reachable) return ctx.skip();
    const c = await createCategory(`${P} Setup`);
    if (!c.ok) throw new Error(c.error);
    expect(await createCategory(`${P} Setup`)).toMatchObject({ ok: false, error: "You already have a group with that name." });
    expect((await createCategory("  ")).ok).toBe(false);
    const t = await createTag(c.id, "FVG");
    if (!t.ok) throw new Error(t.error);
    expect(await createTag(c.id, "FVG")).toMatchObject({ ok: false, error: "That tag already exists in this group." });
    expect((await renameTag(t.id, "Fair value gap")).ok).toBe(true);
    expect((await renameCategory(c.id, `${P} Entry model`)).ok).toBe(true);

    const trade = await db.trade.create({ data: { accountId, brokerTicket: `${P}-tag`, symbol: "XAUUSD", side: "LONG", status: "CLOSED", openedAt: new Date("2031-06-01T01:00:00Z"), closedAt: new Date("2031-06-01T01:10:00Z"), openDay: new Date("2031-06-01T00:00:00Z"), closeDay: new Date("2031-06-01T00:00:00Z"), quantity: 0.1, avgEntry: 1, avgExit: 1, grossPnl: 0, netPnl: 0 } });
    await db.tradeTag.create({ data: { tradeId: trade.id, tagId: t.id } });
    const del = await deleteTag(t.id);
    expect(del).toMatchObject({ ok: true, trades: 1 });
    expect(await db.tradeTag.count({ where: { tradeId: trade.id } })).toBe(0);
    expect((await renameTag(t.id, "x")).ok).toBe(false); // already gone: friendly message, not a crash
    expect(await deleteCategory(c.id)).toMatchObject({ ok: true, trades: 0 });
    expect((await createTag(c.id, "Orphan")).ok).toBe(false);
  });
});

describe("rates and symbols", () => {
  it("saves, updates and deletes a rate", async (ctx) => {
    if (!reachable) return ctx.skip();
    expect((await saveRate({ base: "ZZZ", quote: "AUD", rate: "2" })).ok).toBe(true);
    expect((await saveRate({ base: "zzz", quote: "aud", rate: "2.5" })).ok).toBe(true);
    const rows = await db.fxRate.findMany({ where: { base: "ZZZ" } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rate)).toBe(2.5);
    await deleteRate("ZZZ", "AUD");
    expect(await db.fxRate.count({ where: { base: "ZZZ" } })).toBe(0);
  });
  it("updates a known symbol, refuses an unknown one", async (ctx) => {
    if (!reachable) return ctx.skip();
    const before = await db.symbolConfig.findUnique({ where: { symbol: "XAUUSD" } });
    if (!before) return ctx.skip();
    try {
      expect((await saveSymbol({ symbol: "xauusd", pipSize: "0.1", contractSize: "50" })).ok).toBe(true);
      expect(Number((await db.symbolConfig.findUnique({ where: { symbol: "XAUUSD" } }))?.contractSize)).toBe(50);
    } finally {
      await db.symbolConfig.update({ where: { symbol: "XAUUSD" }, data: { pipSize: before.pipSize, contractSize: before.contractSize } });
    }
    expect((await saveSymbol({ symbol: "NOPE123", pipSize: 1, contractSize: 1 })).ok).toBe(false);
  });
});

describe("change password", () => {
  it("needs the current password, enforces the rules, and then the new one works", async (ctx) => {
    if (!reachable) return ctx.skip();
    const u = await db.user.create({ data: { email: `${P}-user@example.test`, passwordHash: await bcrypt.hash("old-password-123", 4) } });
    expect(await changePassword(u.id, { current: "wrong", next: "brand-new-password", confirm: "brand-new-password" })).toMatchObject({ ok: false, error: "Your current password is not correct." });
    expect((await changePassword(u.id, { current: "old-password-123", next: "short", confirm: "short" })).ok).toBe(false);
    expect((await changePassword(u.id, { current: "old-password-123", next: "brand-new-password", confirm: "brand-new-password" })).ok).toBe(true);
    const now = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare("brand-new-password", now.passwordHash)).toBe(true);
    expect(await bcrypt.compare("old-password-123", now.passwordHash)).toBe(false);
    expect((await changePassword("missing", { current: "a", next: "brand-new-password", confirm: "brand-new-password" })).ok).toBe(false);
  });
});
