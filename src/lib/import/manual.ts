import { round2 } from "@/lib/metrics";
import type { BuiltExecution, BuiltTrade } from "./position-builder";

export interface ManualExecution {
  kind: "ENTRY" | "EXIT";
  at: Date;
  price: number;
  lots: number;
  /** cost of this fill as a positive number (commission/fees) */
  fee: number;
}

export interface ManualTradeInput {
  brokerTicket: string;
  symbol: string;
  side: "LONG" | "SHORT";
  executions: ManualExecution[];
  grossPnl: number;
  swap: number;
  stopLoss: number | null;
  takeProfit: number | null;
  comment: string | null;
}

const EPS = 1e-8;
const wavg = (rows: { v: number; p: number }[]) => {
  const vol = rows.reduce((s, r) => s + r.v, 0);
  return vol ? rows.reduce((s, r) => s + r.v * r.p, 0) / vol : 0;
};

/** Validate a hand-entered trade and turn it into the same shape the MT4 sync produces. Returns an error string on bad input. */
export function buildManualTrade(i: ManualTradeInput): { trade: BuiltTrade } | { error: string } {
  const entries = i.executions.filter((e) => e.kind === "ENTRY");
  const exits = i.executions.filter((e) => e.kind === "EXIT");
  if (entries.length === 0) return { error: "Add at least one entry." };
  if (i.executions.some((e) => !(e.lots > 0) || !(e.price > 0) || Number.isNaN(e.at.getTime()))) return { error: "Every fill needs a valid time, price and lots." };

  const quantity = entries.reduce((s, e) => s + e.lots, 0);
  const exitVol = exits.reduce((s, e) => s + e.lots, 0);
  if (exitVol > quantity + EPS) return { error: "Exits are larger than entries." };

  const openedAt = new Date(Math.min(...entries.map((e) => e.at.getTime())));
  if (exits.some((e) => e.at < openedAt)) return { error: "An exit is before the first entry." };

  const closed = exits.length > 0 && exitVol >= quantity - EPS;
  const commission = -round2(i.executions.reduce((s, e) => s + e.fee, 0));
  const lastExit = [...exits].sort((a, b) => b.at.getTime() - a.at.getTime())[0];

  const executions: BuiltExecution[] = i.executions
    .map((e, idx) => ({
      brokerTicket: `${i.brokerTicket}-${idx + 1}`,
      at: e.at,
      price: e.price,
      quantity: e.kind === "ENTRY" ? e.lots : -e.lots,
      // the whole gross P&L is booked on the final exit (or the first entry while the trade is still open)
      grossPnl: e === lastExit || (!lastExit && e === entries[0]) ? round2(i.grossPnl) : 0,
      fee: -round2(e.fee),
      swap: 0,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    trade: {
      brokerTicket: i.brokerTicket,
      symbol: i.symbol,
      side: i.side,
      status: closed ? "CLOSED" : "OPEN",
      openedAt,
      closedAt: closed ? new Date(Math.max(...exits.map((e) => e.at.getTime()))) : null,
      quantity: Math.round(quantity * 10_000) / 10_000,
      avgEntry: Math.round(wavg(entries.map((e) => ({ v: e.lots, p: e.price }))) * 100_000) / 100_000,
      avgExit: exits.length ? Math.round(wavg(exits.map((e) => ({ v: e.lots, p: e.price }))) * 100_000) / 100_000 : null,
      grossPnl: round2(i.grossPnl),
      commission,
      swap: round2(i.swap),
      netPnl: round2(i.grossPnl + commission + i.swap),
      stopLoss: i.stopLoss,
      takeProfit: i.takeProfit,
      comment: i.comment,
      magic: null,
      executions,
    },
  };
}

/** Rough gross P&L estimate for the form's "auto-calc" button (assumes quote currency = account currency). */
export function estimateGross(side: "LONG" | "SHORT", entries: { lots: number; price: number }[], exits: { lots: number; price: number }[], contractSize: number): number | null {
  const inVol = entries.reduce((s, e) => s + e.lots, 0);
  const outVol = exits.reduce((s, e) => s + e.lots, 0);
  if (!inVol || !outVol) return null;
  const avgIn = entries.reduce((s, e) => s + e.lots * e.price, 0) / inVol;
  const avgOut = exits.reduce((s, e) => s + e.lots * e.price, 0) / outVol;
  return round2((side === "LONG" ? 1 : -1) * (avgOut - avgIn) * outVol * contractSize);
}
