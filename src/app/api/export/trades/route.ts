import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { csvLine } from "@/lib/reports/csv";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

const HEADER = ["Account", "Ticket", "Symbol", "Side", "Status", "Opened (UTC)", "Closed (UTC)", "Lots", "Entry", "Exit", "Stop loss", "Profit target", "Gross P&L", "Commission", "Swap", "Fees", "Net P&L", "Result", "Playbook", "Tags", "Reviewed", "Rating"];

/** Every trade as a CSV file, for backup or a spreadsheet. */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const trades = await db.trade.findMany({
    orderBy: { openedAt: "asc" },
    include: { account: { select: { name: true } }, strategy: { select: { name: true } }, tags: { include: { tag: { select: { name: true } } } } },
  });
  const iso = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 19) : null);
  const num = (v: { toString(): string } | null) => (v == null ? null : Number(v));
  const lines = [csvLine(HEADER)];
  for (const t of trades) {
    lines.push(
      csvLine([t.account.name, t.brokerTicket, t.symbol, t.side, t.status, iso(t.openedAt), iso(t.closedAt), num(t.quantity), num(t.avgEntry), num(t.avgExit), num(t.stopLoss), num(t.profitTarget), num(t.grossPnl), num(t.commission), num(t.swap), num(t.fees), num(t.netPnl), t.result, t.strategy?.name ?? null, t.tags.map((x) => x.tag.name).join("; ") || null, t.reviewed ? "yes" : "no", num(t.rating)]),
    );
  }
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-trades-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
