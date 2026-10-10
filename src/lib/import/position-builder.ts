import { round2 } from "@/lib/metrics";
import type { RawDeal } from "./types";

export interface BuiltExecution {
  brokerTicket: string;
  at: Date;
  price: number;
  quantity: number; // + opens, − closes (0 for bookkeeping-only deals)
  grossPnl: number;
  fee: number;
  swap: number;
}

export interface BuiltTrade {
  /** root position ticket; stable across re-syncs so upserts are idempotent */
  brokerTicket: string;
  symbol: string;
  side: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  openedAt: Date;
  closedAt: Date | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  commission: number;
  swap: number;
  netPnl: number;
  stopLoss: number | null;
  takeProfit: number | null;
  comment: string | null;
  magic: number | null;
  executions: BuiltExecution[];
}

export interface BalanceEventRaw {
  brokerTicket: string;
  at: Date;
  amount: number;
  comment: string | null;
}

export interface BuildResult {
  trades: BuiltTrade[];
  balanceEvents: BalanceEventRaw[];
  /** position ids whose deals are incomplete in the input; fetch them and rebuild */
  needPositionIds: string[];
}

const EPS = 1e-8;
const FROM_RE = /from\s*#\s*(\d+)/i;
const TO_RE = /to\s*#\s*(\d+)/i;

class DisjointSet {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r)! !== r) r = this.parent.get(r)!;
    // path compression
    let c = x;
    while (this.parent.get(c)! !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

const num = (s: string) => Number(s);
const wavg = (rows: { v: number; p: number }[]) => {
  const vol = rows.reduce((s, r) => s + r.v, 0);
  return vol ? rows.reduce((s, r) => s + r.v * r.p, 0) / vol : 0;
};

/**
 * Group broker deals into positions → trades.
 *
 * MT4 partial closes: closing 0.10 of a 0.30-lot order closes the original ticket A (comment "to #B")
 * and leaves a new ticket B (comment "from #A") with the remaining 0.20. A and B are chained
 * (via those comments) into ONE trade rooted at A: entry quantity comes from A only, and each
 * closing deal becomes its own execution (scale-out).
 */
export function buildTrades(deals: RawDeal[]): BuildResult {
  const balanceEvents: BalanceEventRaw[] = [];
  const trading: RawDeal[] = [];
  for (const d of deals) {
    if ((d.kind === "BUY" || d.kind === "SELL") && d.symbol && d.positionId) trading.push(d);
    else if (d.profit !== 0) balanceEvents.push({ brokerTicket: d.id, at: d.time, amount: round2(d.profit), comment: d.comment ?? null });
  }

  const present = new Set(trading.map((d) => d.positionId!));
  const ds = new DisjointSet();
  const referenced = new Set<string>();
  for (const d of trading) {
    ds.find(d.positionId!);
    for (const re of [FROM_RE, TO_RE]) {
      const ref = d.comment?.match(re)?.[1];
      if (ref) {
        referenced.add(ref);
        if (present.has(ref)) ds.union(d.positionId!, ref);
      }
    }
  }

  const groups = new Map<string, RawDeal[]>();
  for (const d of trading) {
    const root = ds.find(d.positionId!);
    groups.set(root, [...(groups.get(root) ?? []), d]);
  }

  const need = new Set<string>([...referenced].filter((id) => !present.has(id)));
  const trades: BuiltTrade[] = [];

  for (const g of groups.values()) {
    const ins = g.filter((d) => d.entry === "IN" || d.entry === "INOUT");
    const outs = g.filter((d) => d.entry === "OUT" || d.entry === "OUT_BY");
    const groupIds = new Set(g.map((d) => d.positionId!));

    // an IN deal that says "from #X" where X is in this group continues X rather than opening new size
    const isContinuation = (d: RawDeal) => {
      const ref = d.comment?.match(FROM_RE)?.[1];
      return !!ref && ref !== d.positionId && groupIds.has(ref);
    };
    const primary = ins.filter((d) => !isContinuation(d));
    const continuations = ins.filter(isContinuation);

    if (primary.length === 0) {
      // closing deals without their opening deal in the input
      for (const d of g) need.add(d.positionId!);
      continue;
    }

    primary.sort((a, b) => a.time.getTime() - b.time.getTime() || num(a.positionId!) - num(b.positionId!));
    const root = primary[0];
    const side = root.kind === "BUY" ? "LONG" : "SHORT";
    const primaryVol = primary.reduce((s, d) => s + d.volume, 0);
    const outVol = outs.reduce((s, d) => s + d.volume, 0);
    const openVol = g.filter((d) => d.openPosition).reduce((s, d) => s + d.volume, 0);
    const hasOpenPos = openVol > 0 || g.some((d) => d.openPosition);
    // Two conventions exist for a partially closed chain:
    //  - MetaApi-style: the opening deal carries the FULL size, later "from #" deals are bookkeeping.
    //  - MT4 order history: the closed part (ticket A) only carries the lots it closed; the remainder (B) carries the rest.
    // Total size is whatever was closed plus whatever is still open, never less than the primary opening size.
    const quantity = Math.max(primaryVol, outVol + openVol);
    const mt4Style = quantity > primaryVol + EPS;
    const avgEntry = wavg((mt4Style ? ins : primary).map((d) => ({ v: d.volume, p: d.price })));
    const closed = !hasOpenPos && outVol >= quantity - EPS && outs.length > 0;

    if (!closed && !hasOpenPos) {
      // part of the position closed / still open but no live position supplied → ask for the rest
      for (const id of groupIds) need.add(id);
    }

    const gross = g.reduce((s, d) => s + d.profit, 0);
    const commission = g.reduce((s, d) => s + d.commission, 0);
    const swap = g.reduce((s, d) => s + d.swap, 0);

    const execs: BuiltExecution[] = [
      ...primary.map((d) => ({ brokerTicket: d.id, at: d.time, price: d.price, quantity: d.volume, grossPnl: round2(d.profit), fee: round2(d.commission), swap: round2(d.swap) })),
      ...continuations.map((d) => ({ brokerTicket: d.id, at: d.time, price: d.price, quantity: mt4Style ? d.volume : 0, grossPnl: round2(d.profit), fee: round2(d.commission), swap: round2(d.swap) })),
      ...outs.map((d) => ({ brokerTicket: d.id, at: d.time, price: d.price, quantity: -d.volume, grossPnl: round2(d.profit), fee: round2(d.commission), swap: round2(d.swap) })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    // last known SL/TP (MT reports the position's latest values on each deal)
    const byTimeDesc = [...g].sort((a, b) => b.time.getTime() - a.time.getTime());
    const sl = byTimeDesc.find((d) => d.stopLoss)?.stopLoss ?? null;
    const tp = byTimeDesc.find((d) => d.takeProfit)?.takeProfit ?? null;

    trades.push({
      brokerTicket: root.positionId!,
      symbol: root.symbol!,
      side,
      status: closed ? "CLOSED" : "OPEN",
      openedAt: root.time,
      closedAt: closed ? new Date(Math.max(...outs.map((d) => d.time.getTime()))) : null,
      quantity: round4(quantity),
      avgEntry: round5(avgEntry),
      avgExit: outs.length ? round5(wavg(outs.map((d) => ({ v: d.volume, p: d.price })))) : null,
      grossPnl: round2(gross),
      commission: round2(commission),
      swap: round2(swap),
      netPnl: round2(gross + commission + swap),
      stopLoss: sl,
      takeProfit: tp,
      comment: root.comment ?? null,
      magic: root.magic ?? null,
      executions: execs,
    });
  }

  return { trades: trades.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime()), balanceEvents, needPositionIds: [...need] };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const round5 = (n: number) => Math.round(n * 100_000) / 100_000;
