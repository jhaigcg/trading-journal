import { db } from "@/lib/db";
import { fileUrl } from "@/lib/queries/trade-detail";
import { checkImage, deleteFile, putImage } from "@/lib/storage";
import type { Candle } from "@/lib/market-data/types";
import { windowCandles } from "./service";
import { firstError, scenarioSchema, tfsFor } from "./validate";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v));

export interface ScenarioRow {
  id: string;
  title: string;
  symbol: string;
  kind: "SETUP" | "EVENT";
  timeframe: string;
  decisionAt: string;
  difficulty: number;
  playbook: string | null;
  hasExpert: boolean;
  attempts: number;
  bestMatch: number | null;
  lastMatch: number | null;
  lastR: number | null;
  lastAt: string | null;
}

export async function listScenarios(): Promise<ScenarioRow[]> {
  const [rows, attempts] = await Promise.all([
    db.trainingScenario.findMany({ where: { archived: false }, orderBy: { createdAt: "desc" }, include: { strategy: { select: { name: true } } } }),
    db.trainingAttempt.findMany({ orderBy: { createdAt: "asc" }, select: { scenarioId: true, matchScore: true, rMultiple: true, createdAt: true } }),
  ]);
  const by = new Map<string, typeof attempts>();
  for (const a of attempts) by.set(a.scenarioId, [...(by.get(a.scenarioId) ?? []), a]);
  return rows.map((s) => {
    const list = by.get(s.id) ?? [];
    const scores = list.map((a) => a.matchScore).filter((x): x is number => x != null);
    const last = list.at(-1);
    return {
      id: s.id,
      title: s.title,
      symbol: s.symbol,
      kind: s.kind,
      timeframe: s.timeframe,
      decisionAt: s.decisionAt.toISOString(),
      difficulty: s.difficulty,
      playbook: s.strategy?.name ?? null,
      hasExpert: s.side != null,
      attempts: list.length,
      bestMatch: scores.length ? Math.max(...scores) : null,
      lastMatch: last?.matchScore ?? null,
      lastR: num(last?.rMultiple),
      lastAt: last?.createdAt.toISOString() ?? null,
    };
  });
}

export interface TrainingStats {
  attempts: number;
  scenariosTried: number;
  avgMatch: number | null;
  avgR: number | null;
  winRate: number | null;
  /** consecutive days, ending today or yesterday, with at least one attempt */
  streakDays: number;
  /** average match by playbook, for the weak-spot view */
  byPlaybook: { name: string; attempts: number; avgMatch: number | null }[];
}

export async function trainingStats(tz: string, now = new Date()): Promise<TrainingStats> {
  const rows = await db.trainingAttempt.findMany({ select: { createdAt: true, matchScore: true, rMultiple: true, filled: true, scenarioId: true, scenario: { select: { strategy: { select: { name: true } } } } } });
  const scores = rows.map((r) => r.matchScore).filter((x): x is number => x != null);
  const rs = rows.map((r) => num(r.rMultiple)).filter((x): x is number => x != null);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const days = new Set(rows.map((r) => day(r.createdAt)));
  let streak = 0;
  const cur = new Date(now);
  if (!days.has(day(cur))) cur.setUTCDate(cur.getUTCDate() - 1); // today not trained yet: the streak counts from yesterday
  while (days.has(day(cur))) {
    streak++;
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  const pb = new Map<string, number[]>();
  for (const r of rows) {
    const name = r.scenario.strategy?.name;
    if (name) pb.set(name, [...(pb.get(name) ?? []), r.matchScore ?? -1]);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    attempts: rows.length,
    scenariosTried: new Set(rows.map((r) => r.scenarioId)).size,
    avgMatch: avg(scores),
    avgR: avg(rs),
    winRate: rs.length ? rs.filter((x) => x > 0).length / rs.length : null,
    streakDays: streak,
    byPlaybook: [...pb.entries()].map(([name, list]) => ({ name, attempts: list.length, avgMatch: avg(list.filter((x) => x >= 0)) })).sort((a, b) => (a.avgMatch ?? 101) - (b.avgMatch ?? 101)),
  };
}

export interface ScenarioEdit {
  id: string;
  title: string;
  symbol: string;
  kind: "SETUP" | "EVENT";
  decisionAt: string;
  timeframe: string;
  horizonMinutes: number;
  lookbackHours: number;
  side: "LONG" | "SHORT" | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  notes: string;
  strategyId: string | null;
  difficulty: number;
  imageUrl: string | null;
}

export async function loadForEdit(id: string): Promise<ScenarioEdit | null> {
  const s = await db.trainingScenario.findUnique({ where: { id } });
  if (!s) return null;
  return { id: s.id, title: s.title, symbol: s.symbol, kind: s.kind, decisionAt: s.decisionAt.toISOString(), timeframe: s.timeframe, horizonMinutes: s.horizonMinutes, lookbackHours: s.lookbackHours, side: s.side, entryLow: num(s.entryLow), entryHigh: num(s.entryHigh), stopLoss: num(s.stopLoss), takeProfit: num(s.takeProfit), notes: s.notes ?? "", strategyId: s.strategyId, difficulty: s.difficulty, imageUrl: s.imageKey ? fileUrl(s.imageKey) : null };
}

/** Create or update a scenario from the form. */
export async function saveScenario(id: string | null, raw: unknown): Promise<Result<{ id: string }>> {
  const p = scenarioSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const v = p.data;
  if (v.strategyId && !(await db.strategy.findUnique({ where: { id: v.strategyId }, select: { id: true } }))) return { ok: false, error: "That playbook no longer exists." };
  const data = {
    title: v.title,
    symbol: v.symbol,
    kind: v.kind,
    decisionAt: v.decisionAt,
    timeframe: v.timeframe,
    horizonMinutes: v.horizonMinutes,
    lookbackHours: v.lookbackHours,
    side: v.side ?? null,
    entryLow: v.entryLow ?? null,
    entryHigh: v.entryHigh ?? null,
    stopLoss: v.stopLoss ?? null,
    takeProfit: v.takeProfit ?? null,
    notes: v.notes || null,
    strategyId: v.strategyId || null,
    difficulty: v.difficulty,
  };
  if (id) {
    const found = await db.trainingScenario.findUnique({ where: { id }, select: { id: true } });
    if (!found) return { ok: false, error: "That scenario no longer exists." };
    await db.trainingScenario.update({ where: { id }, data });
    return { ok: true, id };
  }
  return { ok: true, id: (await db.trainingScenario.create({ data })).id };
}

export async function deleteScenario(id: string): Promise<Result> {
  const s = await db.trainingScenario.findUnique({ where: { id }, select: { imageKey: true } });
  if (!s) return { ok: true };
  await db.trainingScenario.delete({ where: { id } });
  if (s.imageKey) await deleteFile(s.imageKey).catch(() => undefined);
  return { ok: true };
}

/** Attach (replace) the annotated screenshot shown after an attempt. */
export async function setScenarioImage(id: string, file: { type: string; bytes: Buffer }): Promise<Result<{ url: string }>> {
  const s = await db.trainingScenario.findUnique({ where: { id }, select: { imageKey: true } });
  if (!s) return { ok: false, error: "That scenario no longer exists." };
  const check = checkImage(file.type, file.bytes);
  if (!check.ok) return { ok: false, error: check.error };
  const key = await putImage(`training/${id}`, check.ext, file.bytes, file.type);
  await db.trainingScenario.update({ where: { id }, data: { imageKey: key } });
  if (s.imageKey) await deleteFile(s.imageKey).catch(() => undefined);
  return { ok: true, url: fileUrl(key) };
}

export async function removeScenarioImage(id: string): Promise<Result> {
  const s = await db.trainingScenario.findUnique({ where: { id }, select: { imageKey: true } });
  if (!s?.imageKey) return { ok: true };
  await db.trainingScenario.update({ where: { id }, data: { imageKey: null } });
  await deleteFile(s.imageKey).catch(() => undefined);
  return { ok: true };
}

/** For the authoring chart: everything around the chosen moment, future included (the author is allowed to see it). */
export async function loadPreview(input: { symbol: string; atSec: number; tf: string; kind: "SETUP" | "EVENT"; lookbackHours: number; horizonMinutes: number }): Promise<Result<{ candles: Candle[]; incomplete: boolean }>> {
  if (!tfsFor(input.kind).includes(input.tf)) return { ok: false, error: "That timeframe is not available for this kind of scenario." };
  const r = await windowCandles({ symbol: input.symbol, kind: input.kind }, input.tf, input.atSec - input.lookbackHours * 3600, input.atSec + input.horizonMinutes * 60);
  if (r.unsupported) return { ok: false, error: "There is no price history for this symbol." };
  return { ok: true, candles: r.candles, incomplete: r.incomplete };
}
