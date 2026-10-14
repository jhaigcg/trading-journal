import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCandles } from "@/lib/market-data/candle-cache";
import { aggregate } from "@/lib/market-data/aggregate";
import { getTickCandles } from "@/lib/market-data/ticks";
import { TF_SECONDS, type Candle, type Timeframe } from "@/lib/market-data/types";
import { fileUrl } from "@/lib/queries/trade-detail";
import { matchScore, type Expert, type Match } from "./match";
import { limitProblem, simulate, validateOrder, type Order, type SimResult } from "./sim";
import { attemptSchema, firstError, tfsFor, type AttemptInput } from "./validate";

type Scenario = NonNullable<Awaited<ReturnType<typeof db.trainingScenario.findUnique>>>;

export const expertOf = (s: Scenario): Expert | null =>
  s.side && s.entryLow != null && s.entryHigh != null && s.stopLoss != null && s.takeProfit != null ? { side: s.side, entryLow: Number(s.entryLow), entryHigh: Number(s.entryHigh), stopLoss: Number(s.stopLoss), takeProfit: Number(s.takeProfit) } : null;

/** What the player may see before answering. Never contains the expert answer, the notes or the screenshot. */
export interface Question {
  id: string;
  title: string;
  symbol: string;
  kind: "SETUP" | "EVENT";
  tf: string;
  tfs: string[];
  /** the moment the decision has to be made (unix seconds, UTC) */
  decisionT: number;
  horizonMinutes: number;
  difficulty: number;
  /** SETUP: candles up to the decision only. EVENT: the whole window, played back live from the decision. */
  candles: Candle[];
  incomplete: boolean;
  attempts: number;
}

export type Loaded<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 422; error: string };
const fail = (status: 400 | 404 | 422, error: string) => ({ ok: false as const, status, error });

/** Candles for a window on the chosen timeframe; seconds-level data for events, the minute cache for everything else. */
export async function windowCandles(s: Pick<Scenario, "symbol" | "kind">, tf: string, fromSec: number, toSec: number): Promise<{ candles: Candle[]; incomplete: boolean; unsupported: boolean }> {
  if (s.kind === "EVENT") {
    const r = await getTickCandles(s.symbol, fromSec, toSec);
    return { ...r, candles: tf === "S5" ? r.candles : aggregate(r.candles, TF_SECONDS[tf as Timeframe] ?? 60) };
  }
  return getCandles(s.symbol, tf as Timeframe, fromSec, toSec);
}

export async function loadQuestion(id: string, tfParam?: string): Promise<Loaded<Question>> {
  const s = await db.trainingScenario.findUnique({ where: { id } });
  if (!s || s.archived) return fail(404, "That scenario was not found.");
  const tfs = [...tfsFor(s.kind)];
  const tf = tfParam && tfs.includes(tfParam) ? tfParam : tfs.includes(s.timeframe) ? s.timeframe : tfs[0];
  const decisionT = Math.floor(s.decisionAt.getTime() / 1000);
  const from = decisionT - s.lookbackHours * 3600;
  const to = s.kind === "EVENT" ? decisionT + s.horizonMinutes * 60 : decisionT; // a setup is cut at the decision: the future is never sent
  const { candles, incomplete, unsupported } = await windowCandles(s, tf, from, to);
  if (unsupported) return fail(422, "There is no price history for this symbol.");
  if (!candles.length) return fail(422, incomplete ? "Price data could not be downloaded right now. Try again in a moment." : "There is no price data for this time (market closed?).");
  const attempts = await db.trainingAttempt.count({ where: { scenarioId: id } });
  return { ok: true, value: { id: s.id, title: s.title, symbol: s.symbol, kind: s.kind, tf, tfs, decisionT, horizonMinutes: s.horizonMinutes, difficulty: s.difficulty, candles, incomplete, attempts } };
}

export interface AttemptResult {
  attemptId: string;
  order: Order;
  sim: SimResult;
  match: Match | null;
  expert: Expert | null;
  notes: string | null;
  imageUrl: string | null;
  tf: string;
  decisionT: number;
  endT: number;
  /** the whole window including the future, on the chosen timeframe, for the reveal */
  candles: Candle[];
  attemptsBefore: number;
  bestMatch: number | null;
}

/** Place the player's trade on the real candles that followed, score it, store it, and reveal everything. */
export async function submitAttempt(id: string, raw: unknown): Promise<Loaded<AttemptResult>> {
  const parsed = attemptSchema.safeParse(raw);
  if (!parsed.success) return fail(400, firstError(parsed.error));
  const a: AttemptInput = parsed.data;
  const s = await db.trainingScenario.findUnique({ where: { id } });
  if (!s || s.archived) return fail(404, "That scenario was not found.");

  const decisionT = Math.floor(s.decisionAt.getTime() / 1000);
  const endT = decisionT + s.horizonMinutes * 60;
  const tfs = [...tfsFor(s.kind)];
  const tf = a.tf && tfs.includes(a.tf) ? a.tf : tfs.includes(s.timeframe) ? s.timeframe : tfs[0];

  // the candles the trade is judged on: minutes for a setup, seconds for a live event
  let judge: Candle[];
  let order: Order;
  let mode: "touch" | "market" = "touch";
  let entryAt: Date | null = null;
  if (s.kind === "EVENT") {
    if (a.entryT == null) return fail(400, "No entry time was sent.");
    if (a.entryT < decisionT || a.entryT >= endT) return fail(400, "The order was placed outside the replay window.");
    const sec = await getTickCandles(s.symbol, decisionT, endT);
    const placed = sec.candles.find((c) => c.t === a.entryT);
    if (!placed) return fail(422, "That entry moment has no price data. Try the scenario again.");
    if (a.orderType === "limit") {
      // placed at the close of its candle, it can only fill on the candles after
      const wrong = limitProblem(a.side, a.entry, placed.c);
      if (wrong) return fail(400, wrong);
      judge = sec.candles.filter((c) => c.t > a.entryT!);
      if (!judge.length) return fail(422, "The replay ended before the order could fill.");
      order = { side: a.side, entry: a.entry, stopLoss: a.stopLoss, takeProfit: a.takeProfit };
      mode = "touch";
    } else {
      judge = sec.candles.filter((c) => c.t >= a.entryT!);
      order = { side: a.side, entry: placed.c, stopLoss: a.stopLoss, takeProfit: a.takeProfit }; // filled at the close of the candle it was placed on
      mode = "market";
    }
    entryAt = new Date(a.entryT * 1000);
  } else {
    order = { side: a.side, entry: a.entry, stopLoss: a.stopLoss, takeProfit: a.takeProfit };
    const m1 = await getCandles(s.symbol, "M1", decisionT, endT);
    judge = m1.candles;
    if (!judge.length) return fail(422, "There is no price data after this decision to judge the trade on.");
  }
  const bad = validateOrder(order);
  if (bad) return fail(400, bad);

  const sim = simulate(order, judge, mode);
  const expert = expertOf(s);
  const match = expert ? matchScore(order, expert) : null;

  const before = await db.trainingAttempt.findMany({ where: { scenarioId: id }, select: { matchScore: true } });
  const saved = await db.trainingAttempt.create({
    data: {
      scenarioId: id,
      side: order.side,
      entryAt,
      entry: order.entry,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      filled: sim.filled,
      outcome: sim.outcome,
      exitPrice: sim.exitPrice,
      rMultiple: sim.r,
      matchScore: match?.total ?? null,
      details: { match, maeR: sim.maeR, mfeR: sim.mfeR, fillT: sim.fillT, exitT: sim.exitT, tf } as unknown as Prisma.InputJsonValue,
      repeat: before.length > 0,
    },
  });

  const reveal = await windowCandles(s, tf, decisionT - s.lookbackHours * 3600, endT);
  const scores = before.map((b) => b.matchScore).filter((x): x is number => x != null);
  return {
    ok: true,
    value: {
      attemptId: saved.id,
      order,
      sim,
      match,
      expert,
      notes: s.notes,
      imageUrl: s.imageKey ? fileUrl(s.imageKey) : null,
      tf,
      decisionT,
      endT,
      candles: reveal.candles,
      attemptsBefore: before.length,
      bestMatch: scores.length ? Math.max(...scores) : null,
    },
  };
}


export interface Answer {
  expert: Expert | null;
  notes: string | null;
  imageUrl: string | null;
  tf: string;
  decisionT: number;
  endT: number;
  candles: Candle[];
}

/** Give up: show the expert answer and the candles that followed, without recording an attempt. */
export async function loadAnswer(id: string, tfParam?: string): Promise<Loaded<Answer>> {
  const s = await db.trainingScenario.findUnique({ where: { id } });
  if (!s || s.archived) return fail(404, "That scenario was not found.");
  const tfs = [...tfsFor(s.kind)];
  const tf = tfParam && tfs.includes(tfParam) ? tfParam : tfs.includes(s.timeframe) ? s.timeframe : tfs[0];
  const decisionT = Math.floor(s.decisionAt.getTime() / 1000);
  const endT = decisionT + s.horizonMinutes * 60;
  const r = await windowCandles(s, tf, decisionT - s.lookbackHours * 3600, endT);
  return { ok: true, value: { expert: expertOf(s), notes: s.notes, imageUrl: s.imageKey ? fileUrl(s.imageKey) : null, tf, decisionT, endT, candles: r.candles } };
}
