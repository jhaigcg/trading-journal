import { Pnl } from "@/components/ui/pnl";
import { duration, money } from "@/lib/format";
import type { TradeDTO } from "@/lib/queries/trade-detail";
import { fmtDateTime } from "@/lib/time";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--row-line)] py-2 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}

const dash = <span className="text-muted">—</span>;
const R = (v: number | null) => (v == null ? dash : `${v > 0 ? "+" : ""}${v.toFixed(2)}R`);

/** Read-only numbers for a trade. Stop, target, rating and strategy are edited in TradeFields. */
export function TradeStats({ t, tz, publicView }: { t: TradeDTO; tz: string; publicView?: boolean }) {
  const c = t.currency;
  return (
    <dl>
      <Row label="Net P&L">
        <Pnl value={t.netPnl} currency={c} />
      </Row>
      <Row label="Gross P&L">
        <Pnl value={t.grossPnl} currency={c} />
      </Row>
      <Row label="Commission">{money(t.commission, c)}</Row>
      <Row label="Swap">{money(t.swap, c)}</Row>
      {t.fees !== 0 && <Row label="Fees">{money(t.fees, c)}</Row>}
      <Row label="Net ROI">{t.netRoi == null ? dash : `${t.netRoi.toFixed(2)}%`}</Row>
      <Row label="Volume">{t.quantity} lots</Row>
      <Row label="Pips">{t.pips == null ? dash : t.pips.toLocaleString()}</Row>
      <Row label="Avg entry">{t.avgEntry}</Row>
      <Row label="Avg exit">{t.avgExit ?? dash}</Row>
      <Row label="Opened">{fmtDateTime(new Date(t.openedAt), tz)}</Row>
      <Row label="Closed">{t.closedAt ? fmtDateTime(new Date(t.closedAt), tz) : dash}</Row>
      <Row label="Hold time">{t.holdSeconds == null ? dash : duration(t.holdSeconds)}</Row>
      <Row label="Initial risk">{t.tradeRisk == null ? dash : money(t.tradeRisk, c, { signed: false })}</Row>
      <Row label="Planned R">{R(t.plannedR)}</Row>
      <Row label="Realized R">{R(t.realizedR)}</Row>
      <Row label="MAE / MFE price">{t.maePrice == null || t.mfePrice == null ? dash : `${t.maePrice} / ${t.mfePrice}`}</Row>
      {!publicView && <Row label="Account">{t.accountName}</Row>}
      {!publicView && <Row label="Ticket">{t.brokerTicket ?? dash}</Row>}
    </dl>
  );
}
