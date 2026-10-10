import { db } from "@/lib/db";

const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v));

export interface ExecutionDTO {
  id: string;
  at: string; // ISO
  price: number;
  quantity: number;
  grossPnl: number;
  fee: number;
  swap: number;
}

export interface RuleDTO {
  id: string;
  text: string;
  /** null = not answered yet */
  followed: boolean | null;
}

export interface TradeDTO {
  id: string;
  brokerTicket: string | null;
  accountName: string;
  currency: string;
  symbol: string;
  side: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  result: "WIN" | "LOSS" | "BREAKEVEN" | null;
  openedAt: string;
  closedAt: string | null;
  holdSeconds: number | null;
  intraday: boolean;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  commission: number;
  swap: number;
  fees: number;
  netPnl: number;
  netRoi: number | null;
  pips: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
  initialTarget: number | null;
  tradeRisk: number | null;
  plannedR: number | null;
  realizedR: number | null;
  maePrice: number | null;
  mfePrice: number | null;
  rating: number | null;
  reviewed: boolean;
  shareToken: string | null;
  mtComment: string | null;
  contractSize: number;
  pipSize: number;
  closeDay: string | null;
  openDay: string;
  executions: ExecutionDTO[];
  strategy: { id: string; name: string; color: string; groups: { id: string; name: string; rules: RuleDTO[] }[] } | null;
  tags: { id: string; name: string; categoryId: string; category: string }[];
  attachments: { id: string; url: string; mime: string }[];
}

export const fileUrl = (key: string) => (/^https?:\/\//.test(key) ? key : `/api/files/${key}`);

/** Everything a trade view needs, as plain JSON-safe data. */
export async function loadTradeDetail(where: { id: string } | { shareToken: string }): Promise<TradeDTO | null> {
  const t = await db.trade.findUnique({
    where,
    include: {
      account: { select: { name: true, currency: true } },
      executions: { orderBy: { at: "asc" } },
      strategy: { include: { groups: { orderBy: { position: "asc" }, include: { rules: { orderBy: { position: "asc" } } } } } },
      tags: { include: { tag: { include: { category: true } } } },
      attachments: { orderBy: { createdAt: "asc" } },
      ruleChecks: true,
    },
  });
  if (!t) return null;
  const sym = await db.symbolConfig.findUnique({ where: { symbol: t.symbol } });
  const checks = new Map(t.ruleChecks.map((c) => [c.ruleId, c.followed]));

  return {
    id: t.id,
    brokerTicket: t.brokerTicket,
    accountName: t.account.name,
    currency: t.account.currency,
    symbol: t.symbol,
    side: t.side,
    status: t.status,
    result: t.result,
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
    holdSeconds: t.holdSeconds,
    intraday: t.intraday,
    quantity: Number(t.quantity),
    avgEntry: Number(t.avgEntry),
    avgExit: num(t.avgExit),
    grossPnl: Number(t.grossPnl),
    commission: Number(t.commission),
    swap: Number(t.swap),
    fees: Number(t.fees),
    netPnl: Number(t.netPnl),
    netRoi: num(t.netRoi),
    pips: num(t.pips),
    stopLoss: num(t.stopLoss),
    profitTarget: num(t.profitTarget),
    initialTarget: num(t.initialTarget),
    tradeRisk: num(t.tradeRisk),
    plannedR: num(t.plannedR),
    realizedR: num(t.realizedR),
    maePrice: num(t.maePrice),
    mfePrice: num(t.mfePrice),
    rating: num(t.rating),
    reviewed: t.reviewed,
    shareToken: t.shareToken,
    mtComment: t.mtComment,
    contractSize: Number(sym?.contractSize ?? 100),
    pipSize: Number(sym?.pipSize ?? 0.01),
    closeDay: t.closeDay?.toISOString().slice(0, 10) ?? null,
    openDay: t.openDay.toISOString().slice(0, 10),
    executions: t.executions.map((e) => ({ id: e.id, at: e.at.toISOString(), price: Number(e.price), quantity: Number(e.quantity), grossPnl: Number(e.grossPnl), fee: Number(e.fee), swap: Number(e.swap) })),
    strategy: t.strategy
      ? {
          id: t.strategy.id,
          name: t.strategy.name,
          color: t.strategy.color,
          groups: t.strategy.groups.map((g) => ({ id: g.id, name: g.name, rules: g.rules.map((r) => ({ id: r.id, text: r.text, followed: checks.has(r.id) ? checks.get(r.id)! : null })) })),
        }
      : null,
    tags: t.tags.map((x) => ({ id: x.tag.id, name: x.tag.name, categoryId: x.tag.categoryId, category: x.tag.category.name })),
    attachments: t.attachments.map((a) => ({ id: a.id, url: fileUrl(a.storageKey), mime: a.mime })),
  };
}
