import { db } from "@/lib/db";
import { getCandles } from "@/lib/market-data/candle-cache";
import { defaultTimeframe } from "@/lib/market-data/default-tf";
import { TF_SECONDS, type Candle, type Timeframe } from "@/lib/market-data/types";
import { excursions, impliedFx, runningPnl, type PnlPoint } from "@/lib/trades/derive";
import type { TradeDTO } from "./trade-detail";

const BARS_EACH_SIDE = 60;

export interface PriceCheck {
  /** false when the data feed shows a clearly different price from the entry (different broker, feed or symbol) */
  matches: boolean;
  feedPrice: number | null;
  diffPct: number | null;
}

/** Compare the entry price with the feed around the moment of entry. A 0.3% tolerance covers normal broker spread differences. */
export function checkPrices(candles: Candle[], entry: number, openedAtSec: number, stepSec: number): PriceCheck {
  const near = candles.filter((c) => c.t >= openedAtSec - 3 * stepSec && c.t <= openedAtSec + 3 * stepSec);
  if (!near.length) return { matches: true, feedPrice: null, diffPct: null };
  const lo = Math.min(...near.map((c) => c.l));
  const hi = Math.max(...near.map((c) => c.h));
  const tol = entry * 0.003;
  const feed = near.reduce((a, c) => a + c.c, 0) / near.length;
  return { matches: entry >= lo - tol && entry <= hi + tol, feedPrice: feed, diffPct: (Math.abs(entry - feed) / entry) * 100 };
}

export { defaultTimeframe };

export interface ChartMarker {
  /** bar open time the marker sits on (unix seconds) */
  t: number;
  kind: "entry" | "exit";
  /** the order direction: buy = up arrow below the bar, sell = down arrow above */
  action: "buy" | "sell";
  price: number;
  lots: number;
}

export interface ChartData {
  tf: Timeframe;
  candles: Candle[];
  markers: ChartMarker[];
  lines: { entry: number; exit: number | null; stopLoss: number | null; profitTarget: number | null };
  incomplete: boolean;
  unsupported: boolean;
  /** the trade reaches into today (UTC): the data source only publishes a day of minute prices after the day has ended */
  pendingToday: boolean;
  priceCheck: PriceCheck;
}

const sec = (iso: string) => Date.parse(iso) / 1000;
const startOfUtcDay = (nowSec: number) => Math.floor(nowSec / 86_400) * 86_400;

/** `warm` adds extra bars before the trade so moving averages and RSI have settled by the time the trade starts. */
export async function loadChart(t: TradeDTO, tf: Timeframe, now = new Date(), warm = 0): Promise<ChartData> {
  const step = TF_SECONDS[tf];
  const nowSec = now.getTime() / 1000;
  const from = Math.floor((sec(t.openedAt) - (BARS_EACH_SIDE + Math.max(0, warm)) * step) / step) * step;
  const to = Math.min((t.closedAt ? sec(t.closedAt) : nowSec) + BARS_EACH_SIDE * step, nowSec);
  const { candles, incomplete, unsupported } = await getCandles(t.symbol, tf, from, to);

  const long = t.side === "LONG";
  const markers: ChartMarker[] = t.executions
    .filter((e) => e.quantity !== 0)
    .map((e) => {
      const entry = e.quantity > 0;
      return { t: Math.floor(sec(e.at) / step) * step, kind: entry ? "entry" : "exit", action: entry === long ? "buy" : "sell", price: e.price, lots: Math.abs(e.quantity) } as ChartMarker;
    });

  return { tf, candles, markers, lines: { entry: t.avgEntry, exit: t.avgExit, stopLoss: t.stopLoss, profitTarget: t.profitTarget }, incomplete, unsupported, pendingToday: (t.closedAt ? sec(t.closedAt) : nowSec) >= startOfUtcDay(nowSec), priceCheck: checkPrices(candles, t.avgEntry, sec(t.openedAt), step) };
}

export interface RunningData {
  points: PnlPoint[];
  maePrice: number | null;
  mfePrice: number | null;
  /** worst / best floating P&L reached, in account currency (from the same path) */
  worst: number | null;
  best: number | null;
  incomplete: boolean;
  unsupported: boolean;
  pendingToday: boolean;
  priceCheck: PriceCheck;
}

/** Floating + realised P&L over the life of the trade, and MAE/MFE from the price path. */
export async function loadRunning(t: TradeDTO, opts: { persist?: boolean; now?: Date } = {}): Promise<RunningData> {
  const now = opts.now ?? new Date();
  const start = sec(t.openedAt);
  const end = t.closedAt ? sec(t.closedAt) : now.getTime() / 1000;
  // long trades are sampled hourly so the request stays small
  const tf: Timeframe = end - start > 3 * 86_400 ? "H1" : "M1";
  const step = TF_SECONDS[tf];
  const { candles, incomplete, unsupported } = await getCandles(t.symbol, tf, Math.floor(start / step) * step, end + step);

  const execs = t.executions.map((e) => ({ at: new Date(e.at), quantity: e.quantity, grossPnl: e.grossPnl }));
  const fx = impliedFx({ side: t.side, avgEntry: t.avgEntry, avgExit: t.avgExit, grossPnl: t.grossPnl, quantity: t.quantity }, t.contractSize);
  const points = runningPnl({ side: t.side, avgEntry: t.avgEntry, openedAt: new Date(t.openedAt), closedAt: t.closedAt ? new Date(t.closedAt) : null, grossPnl: t.grossPnl }, execs, candles, t.contractSize, fx, step);
  const priceCheck = checkPrices(candles, t.avgEntry, start, step);
  const ex = priceCheck.matches ? excursions(t.side, new Date(t.openedAt), t.closedAt ? new Date(t.closedAt) : null, candles) : null;

  if (opts.persist && ex && !incomplete && (t.maePrice == null || t.mfePrice == null)) {
    await db.trade.update({ where: { id: t.id }, data: { maePrice: ex.maePrice, mfePrice: ex.mfePrice } });
  }
  // a feed that disagrees with the trade would produce a nonsense path: show nothing rather than something wrong
  const shown = priceCheck.matches ? points : [];
  const pnls = shown.map((p) => p.pnl);
  return {
    points: shown,
    maePrice: ex?.maePrice ?? null,
    mfePrice: ex?.mfePrice ?? null,
    worst: pnls.length ? Math.min(...pnls) : null,
    best: pnls.length ? Math.max(...pnls) : null,
    incomplete,
    unsupported,
    pendingToday: end >= startOfUtcDay(now.getTime() / 1000),
    priceCheck,
  };
}
