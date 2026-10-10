import { Pnl } from "@/components/ui/pnl";
import { money } from "@/lib/format";
import type { TradeDTO } from "@/lib/queries/trade-detail";
import { fmtDateTime } from "@/lib/time";

/** Every fill of the trade: entries, scale-ins and partial or final exits. */
export function ExecutionsTable({ t, tz }: { t: TradeDTO; tz: string }) {
  if (!t.executions.length) return <p className="py-6 text-center text-sm text-muted">No executions recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="py-2 pr-3 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Lots</th>
            <th className="px-3 py-2 text-right font-medium">Fee</th>
            <th className="py-2 pl-3 text-right font-medium">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {t.executions.map((e) => {
            const kind = e.quantity > 0 ? "Entry" : e.quantity < 0 ? "Exit" : "Adjustment";
            return (
              <tr key={e.id} className="border-b border-[var(--row-line)]">
                <td className="num whitespace-nowrap py-2 pr-3 text-xs text-ink-2">{fmtDateTime(new Date(e.at), tz)}</td>
                <td className="px-3 py-2">
                  <span className={kind === "Entry" ? "text-long" : kind === "Exit" ? "text-accent" : "text-muted"}>{kind}</span>
                </td>
                <td className="num px-3 py-2 text-right">{e.price}</td>
                <td className="num px-3 py-2 text-right">{Math.abs(e.quantity) || "—"}</td>
                <td className="num px-3 py-2 text-right text-muted">{e.fee ? money(e.fee, t.currency) : "—"}</td>
                <td className="py-2 pl-3 text-right">{e.grossPnl ? <Pnl value={e.grossPnl} currency={t.currency} /> : <span className="text-muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
