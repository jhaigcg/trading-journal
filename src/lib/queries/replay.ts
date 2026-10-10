import { isRealDay } from "@/lib/day";
import { db } from "@/lib/db";
import { getCandles } from "@/lib/market-data/candle-cache";
import { TF_SECONDS, isTimeframe, type Candle, type Timeframe } from "@/lib/market-data/types";
import { chooseTimeframe, combinedPnl, startIndex, type PnlTrade } from "@/lib/replay/series";
import { impliedFx, runningPnl } from "@/lib/trades/derive";
import { checkPrices, defaultTimeframe, type ChartMarker, type PriceCheck } from "./trade-chart";
import { loadTradeDetail, type TradeDTO } from "./trade-detail";

const LEAD_BARS = 40;
const TAIL_BARS = 20;
const MAX_DAY_TRADES = 40;

export interface ReplayTrade {
  id: string;
  side: "LONG" | "SHORT";
  open: number;
  close: number | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
  grossPnl: number;
  netPnl: number;
}

export interface ReplayData {
  mode: "trade" | "day";
  title: string;
  symbol: string;
  currency: string;
  tf: Timeframe;
  candles: Candle[];
  trades: ReplayTrade[];
  markers: ChartMarker[];
  /** running gross P&L at the close of each candle, aligned with `candles` */
  pnl: number[];
  /** candle index playback starts at (the lead-in bars are already showing) */
  start: number;
  incomplete: boolean;
  unsupported: boolean;
  pendingToday: boolean;
  priceCheck: PriceCheck;
  /** the requested timeframe was coarsened to keep the replay a sensible length */
  coarsened: boolean;
  /** day mode: other symbols traded that day */
  otherSymbols: string[];
}

const sec = (iso: string) => Date.parse(iso) / 1000;
const startOfUtcDay = (nowSec: number) => Math.floor(nowSec / 86_400) * 86_400;

/** Replay of one or several trades of one symbol: candles for the window plus a running P&L line. */
async function build(mode: "trade" | "day", title: string, trades: TradeDTO[], requested: Timeframe | null, now: Date, otherSymbols: string[] = []): Promise<ReplayData> {
  const symbol = trades[0].symbol;
  const nowSec = now.getTime() / 1000;
  const opens = trades.map((t) => sec(t.openedAt));
  const closes = trades.map((t) => (t.closedAt ? sec(t.closedAt) : nowSec));
  const firstOpen = Math.min(...opens);
  const lastClose = Math.max(...closes);
  const span = lastClose - firstOpen;
  const wanted = requested ?? (mode === "trade" ? defaultTimeframe(trades[0].holdSeconds) : defaultTimeframe(span / 3));
  const tf = chooseTimeframe(wanted, span + (LEAD_BARS + TAIL_BARS) * TF_SECONDS[wanted]);
  const step = TF_SECONDS[tf];

  const from = Math.floor((firstOpen - LEAD_BARS * step) / step) * step;
  const to = Math.min(lastClose + TAIL_BARS * step, nowSec);
  const { candles, incomplete, unsupported } = await getCandles(symbol, tf, from, to);

  const pnlTrades: PnlTrade[] = trades.map((t) => {
    const execs = t.executions.map((e) => ({ at: new Date(e.at), quantity: e.quantity, grossPnl: e.grossPnl }));
    const fx = impliedFx({ side: t.side, avgEntry: t.avgEntry, avgExit: t.avgExit, grossPnl: t.grossPnl, quantity: t.quantity }, t.contractSize);
    const points = runningPnl({ side: t.side, avgEntry: t.avgEntry, openedAt: new Date(t.openedAt), closedAt: t.closedAt ? new Date(t.closedAt) : null, grossPnl: t.grossPnl }, execs, candles, t.contractSize, fx, step);
    return { open: sec(t.openedAt), close: t.closedAt ? sec(t.closedAt) : null, points, final: t.grossPnl };
  });

  const priceCheck = checkPrices(candles, trades[0].avgEntry, sec(trades[0].openedAt), step);
  const markers: ChartMarker[] = trades.flatMap((t) => {
    const long = t.side === "LONG";
    return t.executions
      .filter((e) => e.quantity !== 0)
      .map((e) => ({ t: Math.floor(sec(e.at) / step) * step, kind: e.quantity > 0 ? "entry" : "exit", action: e.quantity > 0 === long ? "buy" : "sell", price: e.price, lots: Math.abs(e.quantity) }) as ChartMarker);
  });

  return {
    mode,
    title,
    symbol,
    currency: trades[0].currency,
    tf,
    candles,
    trades: trades.map((t) => ({ id: t.id, side: t.side, open: sec(t.openedAt), close: t.closedAt ? sec(t.closedAt) : null, quantity: t.quantity, avgEntry: t.avgEntry, avgExit: t.avgExit, stopLoss: t.stopLoss, profitTarget: t.profitTarget, grossPnl: t.grossPnl, netPnl: t.netPnl })),
    markers,
    // a feed that disagrees with the trade would give a nonsense line: show a flat zero rather than something wrong
    pnl: priceCheck.matches ? combinedPnl(candles, step, pnlTrades) : candles.map(() => 0),
    start: startIndex(candles, firstOpen),
    incomplete,
    unsupported,
    pendingToday: lastClose >= startOfUtcDay(nowSec),
    priceCheck,
    coarsened: tf !== wanted,
    otherSymbols,
  };
}

export async function loadTradeReplay(id: string, tfParam?: string, now = new Date()): Promise<ReplayData | null> {
  const t = await loadTradeDetail({ id });
  if (!t) return null;
  const when = t.openedAt.slice(0, 16).replace("T", " ");
  return build("trade", `${t.symbol} ${t.side === "LONG" ? "long" : "short"} · ${when} UTC`, [t], tfParam && isTimeframe(tfParam) ? tfParam : null, now);
}

/** All of one day's trades in one symbol (the most traded one unless `symbol` is given). Null when the day has no trades. */
export async function loadDayReplay(day: string, symbolParam?: string, tfParam?: string, now = new Date()): Promise<ReplayData | null> {
  if (!isRealDay(day)) return null;
  const rows = await db.trade.findMany({ where: { closeDay: new Date(`${day}T00:00:00Z`), status: "CLOSED" }, select: { id: true, symbol: true }, orderBy: { openedAt: "asc" } });
  if (!rows.length) return null;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.symbol, (counts.get(r.symbol) ?? 0) + 1);
  const symbols = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const symbol = symbolParam && counts.has(symbolParam) ? symbolParam : symbols[0];
  const picked = rows.filter((r) => r.symbol === symbol).slice(0, MAX_DAY_TRADES);
  const trades = (await Promise.all(picked.map((r) => loadTradeDetail({ id: r.id })))).filter((t): t is TradeDTO => !!t);
  if (!trades.length) return null;
  return build("day", `${symbol} · ${day}`, trades, tfParam && isTimeframe(tfParam) ? tfParam : null, now, symbols.filter((s) => s !== symbol));
}

export interface ReplayPick {
  recentTrades: { id: string; symbol: string; side: "LONG" | "SHORT"; openedAt: string; netPnl: number; currency: string }[];
  recentDays: { day: string; trades: number; net: number }[];
}

/** What the replay page offers to pick from: the latest closed trades and trading days. */
export async function loadReplayPicks(): Promise<ReplayPick> {
  const [trades, days] = await Promise.all([
    db.trade.findMany({ where: { status: "CLOSED" }, orderBy: { closedAt: "desc" }, take: 30, select: { id: true, symbol: true, side: true, openedAt: true, netPnl: true, account: { select: { currency: true } } } }),
    db.$queryRaw<{ day: string; trades: number; net: unknown }[]>`SELECT t."closeDay"::text AS "day", count(*)::int AS "trades", coalesce(sum(t."netPnl"), 0) AS "net" FROM "Trade" t WHERE t."status" = 'CLOSED' AND t."closeDay" IS NOT NULL GROUP BY t."closeDay" ORDER BY t."closeDay" DESC LIMIT 30`,
  ]);
  return {
    recentTrades: trades.map((t) => ({ id: t.id, symbol: t.symbol, side: t.side as "LONG" | "SHORT", openedAt: t.openedAt.toISOString(), netPnl: Number(t.netPnl), currency: t.account.currency })),
    recentDays: days.map((d) => ({ day: d.day, trades: Number(d.trades), net: Number(d.net) })),
  };
}
