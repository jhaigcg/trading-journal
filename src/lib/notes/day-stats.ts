import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters/params";
import { tradeWhere } from "@/lib/filters/where";
import { money, pct, ratio } from "@/lib/format";
import { summaryFromAggregates } from "@/lib/metrics";
import { loadAggregates } from "@/lib/queries/aggregate";
import { settingsFor } from "@/lib/queries/trade-list";

type Node = Record<string, unknown>;
const text = (t: string): Node => ({ type: "text", text: t });
const para = (t: string): Node => ({ type: "paragraph", content: [text(t)] });
const item = (t: string): Node => ({ type: "listItem", content: [para(t)] });

/**
 * A snapshot of one trading day as editor content (a heading and a short list), for pasting into a daily journal.
 * It is a snapshot on purpose: a journal entry should keep saying what the day looked like when it was written.
 */
export async function dayStatsBlock(day: string, accountId?: string): Promise<{ nodes: Node[]; trades: number }> {
  const { tz, thr, home } = await settingsFor();
  const f = parseFilters({ range: "custom", from: day, to: day, account: accountId });
  const where = tradeWhere(f, { tz });
  const agg = await loadAggregates(where, thr);
  const heading: Node = { type: "heading", attrs: { level: 3 }, content: [text(`Day stats · ${day}`)] };
  if (agg.count === 0) return { nodes: [heading, para(`No closed trades on ${day}.`)], trades: 0 };

  const s = summaryFromAggregates(agg);
  const extremes = await db.$queryRaw<{ best: unknown; worst: unknown }[]>`SELECT max(t."netPnl") AS best, min(t."netPnl") AS worst FROM "Trade" t ${where}`;
  const best = Number(extremes[0]?.best ?? 0);
  const worst = Number(extremes[0]?.worst ?? 0);
  const m = (v: number, signed = true) => money(v, home, { signed });

  return {
    trades: s.count,
    nodes: [
      heading,
      {
        type: "bulletList",
        content: [
          item(`Net P&L: ${m(s.netPnl)} (gross ${m(s.grossPnl, false)}, fees ${m(s.fees, false)})`),
          item(`Trades: ${s.count} (${s.wins} W · ${s.breakevens} BE · ${s.losses} L), win rate ${pct(s.winRate, 0)}`),
          item(`Profit factor: ${ratio(s.profitFactor)} · Avg win ${m(s.avgWin)} / avg loss ${m(s.avgLoss)}`),
          item(`Best trade ${m(best)} · worst trade ${m(worst)}`),
          item(`Volume: ${s.volume.toFixed(2)} lots`),
        ],
      },
    ],
  };
}
