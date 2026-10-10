import { plannedR, realizedR, riskAmount, round2 } from "@/lib/metrics";
import type { Candle } from "@/lib/market-data/types";

export interface RiskInput {
  side: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  avgEntry: number;
  avgExit: number | null;
  quantity: number;
  grossPnl: number;
  netPnl: number;
  stopLoss: number | null;
  /** the plan: the first target set for the trade */
  initialTarget: number | null;
}

/**
 * Account-currency value of one price unit per lot, implied by the realised trade itself
 * (gross P&L ÷ price move ÷ lots ÷ contract size). Falls back to 1 for open or flat trades.
 */
export function impliedFx(t: Pick<RiskInput, "side" | "avgEntry" | "avgExit" | "grossPnl" | "quantity">, contractSize: number): number {
  if (t.avgExit == null) return 1;
  const move = (t.side === "LONG" ? 1 : -1) * (t.avgExit - t.avgEntry);
  if (!move || !t.quantity) return 1;
  const fx = t.grossPnl / (move * t.quantity * contractSize);
  return fx > 0 && Number.isFinite(fx) ? fx : 1;
}

/** Initial risk and R multiples. Single source of truth for sync, manual entry and journal edits. */
export function deriveRisk(t: RiskInput, contractSize: number, fx = impliedFx(t, contractSize)) {
  const risk = riskAmount({ entry: t.avgEntry, stop: t.stopLoss, lots: t.quantity, contractSize, fxToAccount: fx });
  const planned = plannedR(t.avgEntry, t.stopLoss, t.initialTarget);
  const realized = t.status === "CLOSED" ? realizedR(t.netPnl, risk) : null;
  return {
    tradeRisk: risk,
    plannedR: planned == null ? null : round2(planned),
    realizedR: realized == null ? null : round2(realized),
  };
}

export interface ExecutionLite {
  at: Date;
  quantity: number; // + entry, − exit, 0 bookkeeping
  grossPnl: number;
}

export interface PnlPoint {
  t: number; // unix seconds
  pnl: number; // gross P&L (realised + floating) in account currency
}

/**
 * Gross P&L over the life of a trade: realised profit from partial exits plus the floating profit on what is
 * still open, sampled at each candle close, ending exactly on the final gross P&L.
 */
export function runningPnl(
  trade: { side: "LONG" | "SHORT"; avgEntry: number; openedAt: Date; closedAt: Date | null; grossPnl: number },
  executions: ExecutionLite[],
  candles: Candle[],
  contractSize: number,
  fx: number,
  candleSeconds = 60,
): PnlPoint[] {
  const dir = trade.side === "LONG" ? 1 : -1;
  const start = trade.openedAt.getTime() / 1000;
  const end = trade.closedAt ? trade.closedAt.getTime() / 1000 : Infinity;
  const execs = executions.filter((e) => e.quantity !== 0).sort((a, b) => a.at.getTime() - b.at.getTime());

  const at = (tc: number) => {
    let qty = 0;
    let realised = 0;
    for (const e of execs) {
      if (e.at.getTime() / 1000 > tc) break;
      qty += e.quantity;
      if (e.quantity < 0) realised += e.grossPnl;
    }
    return { qty: Math.max(qty, 0), realised };
  };

  const pts: PnlPoint[] = [{ t: start, pnl: 0 }];
  for (const c of candles) {
    const tc = c.t + candleSeconds;
    if (tc <= start || c.t >= end) continue;
    const s = at(Math.min(tc, end));
    pts.push({ t: Math.min(tc, end), pnl: round2(s.realised + dir * (c.c - trade.avgEntry) * s.qty * contractSize * fx) });
  }
  if (trade.closedAt) pts.push({ t: end, pnl: round2(trade.grossPnl) });
  return pts;
}

export interface Excursion {
  /** worst price against the position while it was open */
  maePrice: number;
  /** best price in favour of the position */
  mfePrice: number;
}

export function excursions(side: "LONG" | "SHORT", openedAt: Date, closedAt: Date | null, candles: Candle[]): Excursion | null {
  const from = Math.floor(openedAt.getTime() / 60_000) * 60;
  const to = closedAt ? closedAt.getTime() / 1000 : Infinity;
  const inside = candles.filter((c) => c.t >= from && c.t <= to);
  if (!inside.length) return null;
  const hi = Math.max(...inside.map((c) => c.h));
  const lo = Math.min(...inside.map((c) => c.l));
  return side === "LONG" ? { maePrice: lo, mfePrice: hi } : { maePrice: hi, mfePrice: lo };
}
