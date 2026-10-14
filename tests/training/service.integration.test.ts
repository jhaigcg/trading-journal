/**
 * Training scenarios against real cached XAUUSD minutes (6 Oct 2026 09:00-10:00 UTC, stored by the earlier chart tests).
 * Skipped when the database or those prices are absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getCandles } from "@/lib/market-data/candle-cache";
import type { Candle } from "@/lib/market-data/types";
import { deleteScenario, listScenarios, loadForEdit, saveScenario, trainingStats } from "@/lib/training/scenarios";
import { loadQuestion, submitAttempt } from "@/lib/training/service";
import { simulate } from "@/lib/training/sim";

const P = "TEST-train";
const DECISION = Date.parse("2026-10-06T09:20:00Z") / 1000;
let ready = false;
let m1: Candle[] = [];
let lastClose = 0;
let id = "";

const form = (over: Record<string, unknown> = {}) => ({
  title: `${P} scenario`,
  symbol: "XAUUSD",
  kind: "SETUP",
  decisionAt: new Date(DECISION * 1000).toISOString(),
  timeframe: "M5",
  horizonMinutes: 30,
  lookbackHours: 2,
  difficulty: 2,
  side: "LONG",
  entryLow: lastClose - 1,
  entryHigh: lastClose + 1,
  stopLoss: lastClose - 6,
  takeProfit: lastClose + 8,
  notes: "Sweep then reaction",
  ...over,
});

beforeAll(async () => {
  try {
    const r = await getCandles("XAUUSD", "M1", DECISION - 7200, DECISION + 1800, { maxFetch: 0 });
    m1 = r.candles;
    const before = m1.filter((c) => c.t < DECISION);
    if (before.length < 60 || m1.filter((c) => c.t >= DECISION).length < 20) return;
    lastClose = before.at(-1)!.c;
    ready = true;
  } catch {
    ready = false;
  }
});
afterAll(async () => {
  await db.trainingScenario.deleteMany({ where: { title: { startsWith: P } } });
  await db.$disconnect();
});

describe("saving scenarios", () => {
  it("creates, reads back, updates and refuses a half-finished or inconsistent expert answer", async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await saveScenario(null, form());
    if (!r.ok) throw new Error(r.error);
    id = r.id;
    const back = (await loadForEdit(id))!;
    expect(back).toMatchObject({ title: `${P} scenario`, kind: "SETUP", side: "LONG", horizonMinutes: 30, notes: "Sweep then reaction" });
    expect(back.entryLow).toBeCloseTo(lastClose - 1);
    expect((await saveScenario(id, form({ title: `${P} renamed` }))).ok).toBe(true);
    expect((await loadForEdit(id))!.title).toBe(`${P} renamed`);

    const err = async (over: Record<string, unknown>) => {
      const x = await saveScenario(null, form(over));
      return x.ok ? "" : x.error;
    };
    expect(await err({ takeProfit: "" })).toContain("whole expert answer");
    expect(await err({ stopLoss: lastClose + 5 })).toContain("below the entry zone");
    expect(await err({ timeframe: "S5" })).toContain("Choose one of");
    expect(await err({ symbol: "COTTON" })).toContain("no price history");
    expect(await err({ decisionAt: new Date().toISOString() })).toContain("in the past");
    expect(await err({ title: "" })).toContain("title");
    expect(await err({ horizonMinutes: 1 })).toContain("5 minutes");
    expect((await saveScenario("nope", form())).ok).toBe(false);
    // no expert answer at all is fine: the attempt is then judged on its result only
    const bare = await saveScenario(null, form({ side: undefined, entryLow: "", entryHigh: "", stopLoss: "", takeProfit: "", title: `${P} bare` }));
    expect(bare.ok).toBe(true);
  });
});

describe("the question never contains the future", () => {
  it("every candle ends before the decision, on every timeframe, and the answer is not in the payload", async (ctx) => {
    if (!ready) return ctx.skip();
    for (const tf of ["M1", "M5", "M15", "H1"]) {
      const q = await loadQuestion(id, tf);
      if (!q.ok) throw new Error(q.error);
      expect(q.value.tf).toBe(tf);
      expect(q.value.candles.length).toBeGreaterThan(0);
      expect(Math.max(...q.value.candles.map((c) => c.t))).toBeLessThan(DECISION);
      const json = JSON.stringify(q.value);
      for (const secret of ["Sweep then reaction", "entryLow", "takeProfit", "imageKey"]) expect(json).not.toContain(secret);
    }
    const q5 = await loadQuestion(id, "M5");
    if (!q5.ok) throw new Error(q5.error);
    // the last bar is the one still forming at the decision: built only from minutes before it
    const last = q5.value.candles.at(-1)!;
    const minutes = m1.filter((c) => c.t >= last.t && c.t < DECISION);
    expect(last.h).toBeCloseTo(Math.max(...minutes.map((c) => c.h)));
    expect(last.c).toBeCloseTo(minutes.at(-1)!.c);
  }, 60_000);
  it("unknown scenarios and unsupported timeframes fall back sensibly", async (ctx) => {
    if (!ready) return ctx.skip();
    expect((await loadQuestion("missing")).ok).toBe(false);
    const q = await loadQuestion(id, "S5");
    expect(q.ok && q.value.tf).toBe("M5"); // 5s is for events only: the scenario's own timeframe is used
  });
});

describe("attempts", () => {
  it("are judged on the real minutes that followed, exactly as the simulator does, and compared with the expert", async (ctx) => {
    if (!ready) return ctx.skip();
    const order = { side: "LONG" as const, entry: lastClose, stopLoss: lastClose - 4, takeProfit: lastClose + 5 };
    const r = await submitAttempt(id, { ...order, tf: "M5" });
    if (!r.ok) throw new Error(r.error);
    const after = m1.filter((c) => c.t >= DECISION && c.t < DECISION + 1800);
    const want = simulate(order, after, "touch");
    expect(r.value.sim.outcome).toBe(want.outcome);
    expect(r.value.sim.r).toBe(want.r);
    expect(r.value.match!.total).toBeGreaterThan(50); // close to the expert zone, stop and target
    expect(r.value.expert).toMatchObject({ side: "LONG" });
    expect(r.value.notes).toBe("Sweep then reaction");
    expect(r.value.candles.some((c) => c.t >= DECISION)).toBe(true); // the future is revealed now
    expect(r.value.attemptsBefore).toBe(0);

    const again = await submitAttempt(id, { ...order, tf: "M5" });
    if (!again.ok) throw new Error(again.error);
    expect(again.value.attemptsBefore).toBe(1);
    expect(again.value.bestMatch).toBe(r.value.match!.total);
    expect(await db.trainingAttempt.count({ where: { scenarioId: id } })).toBe(2);
    expect((await db.trainingAttempt.findMany({ where: { scenarioId: id }, orderBy: { createdAt: "asc" } })).map((a) => a.repeat)).toEqual([false, true]);
  });
  it("wrong direction scores zero on the match but still reports what the trade did", async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await submitAttempt(id, { side: "SHORT", entry: lastClose, stopLoss: lastClose + 4, takeProfit: lastClose - 5 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.match!.total).toBe(0);
    expect(r.value.sim.outcome).toMatch(/TP|SL|TIMEOUT|NO_FILL/);
  });
  it("an order that never fills is a no-trade", async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await submitAttempt(id, { side: "LONG", entry: lastClose - 60, stopLoss: lastClose - 70, takeProfit: lastClose - 40 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.sim).toMatchObject({ filled: false, outcome: "NO_FILL", r: null });
  });
  it("refuses impossible orders and unknown scenarios, and a scenario without an expert answer still works", async (ctx) => {
    if (!ready) return ctx.skip();
    const bad = await submitAttempt(id, { side: "LONG", entry: lastClose, stopLoss: lastClose + 1, takeProfit: lastClose + 5 });
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect((await submitAttempt("missing", { side: "LONG", entry: 1, stopLoss: 0.5, takeProfit: 2 })).ok).toBe(false);
    expect((await submitAttempt(id, { side: "UP" })).ok).toBe(false);
    const bare = (await db.trainingScenario.findFirst({ where: { title: `${P} bare` } }))!;
    const r = await submitAttempt(bare.id, { side: "LONG", entry: lastClose, stopLoss: lastClose - 4, takeProfit: lastClose + 5 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.match).toBeNull();
    expect(r.value.expert).toBeNull();
  });
});

describe("the list and the statistics", () => {
  it("count attempts, best and last scores, and the streak", async (ctx) => {
    if (!ready) return ctx.skip();
    const rows = (await listScenarios()).filter((s) => s.title.startsWith(P));
    const row = rows.find((s) => s.id === id)!;
    expect(row.attempts).toBe(4);
    expect(row.bestMatch).toBeGreaterThan(0);
    expect(row.hasExpert).toBe(true);
    const stats = await trainingStats("Asia/Hong_Kong");
    expect(stats.attempts).toBeGreaterThanOrEqual(5);
    expect(stats.streakDays).toBeGreaterThanOrEqual(1);
    expect(stats.avgMatch).not.toBeNull();
  });
  it("deleting a scenario removes it and its attempts", async (ctx) => {
    if (!ready) return ctx.skip();
    await deleteScenario(id);
    expect(await db.trainingAttempt.count({ where: { scenarioId: id } })).toBe(0);
    expect(await loadForEdit(id)).toBeNull();
    expect((await deleteScenario(id)).ok).toBe(true);
  });
});
