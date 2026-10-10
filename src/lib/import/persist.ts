import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { classify, holdSeconds, pips } from "@/lib/metrics";
import { deriveRisk } from "@/lib/trades/derive";
import { dayKey } from "@/lib/time";
import type { BalanceEventRaw, BuiltTrade } from "./position-builder";
import { normaliseSymbol, type SymbolAliasConfig } from "./symbols";

export interface SymbolInfo extends SymbolAliasConfig {
  pipSize: number;
  contractSize: number;
  instrumentType: "FOREX_CFD" | "FUTURES" | "STOCK";
}

export interface PersistContext {
  accountId: string;
  tz: string;
  breakevenThreshold: number;
  symbols: SymbolInfo[];
}

const dateOnly = (key: string) => new Date(`${key}T00:00:00Z`);
const RESULT = { WIN: "WIN", LOSS: "LOSS", BE: "BREAKEVEN" } as const;
const CHUNK = 200;
const chunks = <T,>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Heuristic defaults for a symbol we have not seen before (editable later in Settings). */
export function defaultSymbolInfo(symbol: string): Omit<SymbolInfo, "aliases"> {
  if (symbol.startsWith("XAU")) return { symbol, pipSize: 0.01, contractSize: 100, instrumentType: "FOREX_CFD" };
  if (symbol.startsWith("XAG")) return { symbol, pipSize: 0.001, contractSize: 5000, instrumentType: "FOREX_CFD" };
  if (symbol.includes("JPY")) return { symbol, pipSize: 0.01, contractSize: 100_000, instrumentType: "FOREX_CFD" };
  return { symbol, pipSize: 0.0001, contractSize: 100_000, instrumentType: "FOREX_CFD" };
}

export async function loadSymbols(): Promise<SymbolInfo[]> {
  const rows = await db.symbolConfig.findMany();
  return rows.map((r) => ({ symbol: r.symbol, aliases: r.aliases, pipSize: Number(r.pipSize), contractSize: Number(r.contractSize), instrumentType: r.instrumentType }));
}

export interface PersistResult {
  created: number;
  updated: number;
  /** closing days (YYYY-MM-DD) whose daily summary must be recomputed */
  touchedDays: string[];
}

export async function persistTrades(ctx: PersistContext, built: BuiltTrade[]): Promise<PersistResult> {
  if (!built.length) return { created: 0, updated: 0, touchedDays: [] };

  // make sure every symbol has a config row
  const normalised = built.map((t) => ({ ...t, symbol: normaliseSymbol(t.symbol, ctx.symbols) }));
  for (const sym of new Set(normalised.map((t) => t.symbol))) {
    if (!ctx.symbols.some((s) => s.symbol === sym)) {
      const d = defaultSymbolInfo(sym);
      await db.symbolConfig.upsert({ where: { symbol: sym }, update: {}, create: { symbol: sym, pipSize: d.pipSize, contractSize: d.contractSize, instrumentType: d.instrumentType, aliases: [] } });
      ctx.symbols.push({ ...d, aliases: [] });
    }
  }
  const info = (sym: string) => ctx.symbols.find((s) => s.symbol === sym)!;

  const existing = await db.trade.findMany({
    where: { accountId: ctx.accountId, brokerTicket: { in: normalised.map((t) => t.brokerTicket) } },
  });
  const byTicket = new Map(existing.map((e) => [e.brokerTicket!, e]));
  const touched = new Set<string>();
  for (const e of existing) if (e.closeDay) touched.add(e.closeDay.toISOString().slice(0, 10));

  const creates: Prisma.TradeCreateManyInput[] = [];
  const updates: { id: string; data: Prisma.TradeUpdateInput }[] = [];
  const execsByTicket = new Map<string, BuiltTrade["executions"]>();

  for (const t of normalised) {
    const sym = info(t.symbol);
    const prev = byTicket.get(t.brokerTicket);
    // the broker's SL/TP only fill gaps: anything I edited in the journal wins
    const stop = prev?.stopLoss != null ? Number(prev.stopLoss) : t.stopLoss;
    const target = prev?.profitTarget != null ? Number(prev.profitTarget) : t.takeProfit;
    const initialTarget = prev?.initialTarget != null ? Number(prev.initialTarget) : t.takeProfit;

    const closed = t.status === "CLOSED";
    const r = deriveRisk({ side: t.side, status: t.status, avgEntry: t.avgEntry, avgExit: t.avgExit, quantity: t.quantity, grossPnl: t.grossPnl, netPnl: t.netPnl, stopLoss: stop, initialTarget }, sym.contractSize);
    const openDay = dayKey(t.openedAt, ctx.tz);
    const closeDay = t.closedAt ? dayKey(t.closedAt, ctx.tz) : null;
    if (closeDay) touched.add(closeDay);

    const data = {
      symbol: t.symbol,
      instrumentType: sym.instrumentType,
      side: t.side,
      status: t.status,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      holdSeconds: holdSeconds(t.openedAt, t.closedAt),
      intraday: closeDay ? closeDay === openDay : true,
      openDay: dateOnly(openDay),
      closeDay: closeDay ? dateOnly(closeDay) : null,
      quantity: t.quantity,
      avgEntry: t.avgEntry,
      avgExit: t.avgExit,
      grossPnl: t.grossPnl,
      commission: t.commission,
      swap: t.swap,
      netPnl: t.netPnl,
      pips: t.avgExit != null ? pips(t.avgEntry, t.avgExit, t.side, sym.pipSize) : null,
      result: closed ? RESULT[classify(t.netPnl, ctx.breakevenThreshold)] : null,
      stopLoss: stop,
      profitTarget: target,
      initialTarget,
      tradeRisk: r.tradeRisk,
      plannedR: r.plannedR,
      realizedR: r.realizedR,
      mtComment: t.comment,
      magicNumber: t.magic,
    };
    execsByTicket.set(t.brokerTicket, t.executions);
    if (prev) updates.push({ id: prev.id, data });
    else creates.push({ ...data, accountId: ctx.accountId, brokerTicket: t.brokerTicket });
  }

  const idByTicket = new Map<string, string>(existing.map((e) => [e.brokerTicket!, e.id]));

  await db.$transaction(
    async (tx) => {
      for (const c of chunks(creates)) {
        const rows = await tx.trade.createManyAndReturn({ data: c, select: { id: true, brokerTicket: true } });
        for (const r of rows) idByTicket.set(r.brokerTicket!, r.id);
      }
      for (const u of updates) await tx.trade.update({ where: { id: u.id }, data: u.data });

      // executions are fully derived from broker deals, so replace them wholesale
      const ids = [...idByTicket.values()];
      await tx.execution.deleteMany({ where: { tradeId: { in: ids } } });
      const rows: Prisma.ExecutionCreateManyInput[] = [];
      for (const [ticket, execs] of execsByTicket) {
        const tradeId = idByTicket.get(ticket)!;
        for (const e of execs) rows.push({ tradeId, brokerTicket: e.brokerTicket, at: e.at, price: e.price, quantity: e.quantity, grossPnl: e.grossPnl, fee: e.fee, swap: e.swap });
      }
      for (const c of chunks(rows, 500)) await tx.execution.createMany({ data: c, skipDuplicates: true });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return { created: creates.length, updated: updates.length, touchedDays: [...touched] };
}

export async function persistBalanceEvents(accountId: string, events: BalanceEventRaw[]) {
  for (const c of chunks(events)) {
    await db.balanceEvent.createMany({
      data: c.map((e) => ({ accountId, brokerTicket: e.brokerTicket, at: e.at, amount: e.amount, comment: e.comment })),
      skipDuplicates: true,
    });
  }
}

/** Recompute the materialised per-day summary for the given closing days. */
export async function refreshDailySummary(accountId: string, days: string[], breakevenThreshold = 0) {
  if (!days.length) return;
  const t = breakevenThreshold;
  await db.$transaction([
    db.dailySummary.deleteMany({ where: { accountId, day: { in: days.map(dateOnly) } } }),
    db.$executeRaw`
      INSERT INTO "DailySummary" ("accountId","day","trades","wins","losses","breakevens","grossPnl","commission","swap","netPnl","volume","grossWin","grossLoss")
      SELECT "accountId", "closeDay", count(*)::int,
        (count(*) FILTER (WHERE "netPnl" > ${t}::numeric))::int,
        (count(*) FILTER (WHERE "netPnl" < -(${t}::numeric)))::int,
        (count(*) FILTER (WHERE abs("netPnl") <= ${t}::numeric))::int,
        sum("grossPnl"), sum("commission"), sum("swap"), sum("netPnl"), sum("quantity"),
        coalesce(sum("netPnl") FILTER (WHERE "netPnl" > ${t}::numeric), 0),
        coalesce(sum("netPnl") FILTER (WHERE "netPnl" < -(${t}::numeric)), 0)
      FROM "Trade"
      WHERE "accountId" = ${accountId} AND "status" = 'CLOSED' AND "closeDay" = ANY(${days}::date[])
      GROUP BY "accountId", "closeDay"`,
  ]);
}
