import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { cellText, type CalendarSection, type Cell, type HeatmapSection, type KvSection, type ReportDoc, type Section, type TableSection } from "@/lib/reports/doc";
import { ReportChart } from "./report-chart";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const tone = (v: Cell, unit?: string) => (typeof v === "number" && (unit === "money" || unit === "r") ? (v > 0 ? "text-profit" : v < 0 ? "text-loss" : "") : "");

/** Background tint for a P&L value relative to the largest absolute value in the section. */
const tint = (v: number, max: number) => `color-mix(in srgb, var(${v >= 0 ? "--profit" : "--loss"}) ${Math.max(12, Math.round((Math.abs(v) / (max || 1)) * 70))}%, transparent)`;

function Kv({ s, currency }: { s: KvSection; currency: string }) {
  return (
    <Card>
      <CardHeader title={s.title} />
      <dl className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-8 gap-y-1">
        {s.rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt className="text-[13px] text-muted">{r.label}</dt>
            <dd className={cn("num text-right text-[13px] font-medium", r.tone === "loss" ? "text-loss" : tone(r.value, r.unit))}>
              {cellText(r.value, r.unit, currency)}
              {r.note && <span className="ml-2 text-xs font-normal text-muted">{r.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Table({ s, currency }: { s: TableSection; currency: string }) {
  return (
    <Card className="p-0">
      <div className="px-4 pt-4">
        <CardHeader title={s.title} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              {s.columns.map((c, i) => (
                <th key={c.key} className={cn("px-3 py-2.5 font-medium", i === 0 && "px-4", i > 0 && "text-right")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.length === 0 && (
              <tr>
                <td colSpan={s.columns.length} className="px-4 py-8 text-center text-muted">
                  Nothing to show for these filters.
                </td>
              </tr>
            )}
            {s.rows.map((r, ri) => (
              <tr key={ri} className="border-b border-line last:border-0">
                {s.columns.map((c, i) => {
                  const unit = s.rowUnits?.[ri] ?? c.unit;
                  const v = r[i] ?? null;
                  const href = i === 0 ? s.hrefs?.[ri] : null;
                  return (
                    <td key={c.key} className={cn("px-3 py-2.5", i === 0 ? "px-4 text-left" : "num text-right", i > 0 && tone(v, unit))}>
                      {href ? (
                        <Link href={href} className="hover:text-accent">
                          {cellText(v, unit, currency)}
                        </Link>
                      ) : (
                        cellText(v, unit, currency)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.note && <p className="px-4 pb-3 pt-2 text-xs text-muted">{s.note}</p>}
    </Card>
  );
}

function Heatmap({ s, currency }: { s: HeatmapSection; currency: string }) {
  const max = Math.max(1, ...s.values.flat().map((v) => Math.abs(v ?? 0)));
  return (
    <Card>
      <CardHeader title={s.title} />
      <div className="mt-3 overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]" aria-label={s.title}>
          <thead>
            <tr>
              <th />
              {s.colLabels.map((h) => (
                <th key={h} className="px-0.5 font-normal text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rowLabels.map((day, r) => (
              <tr key={day}>
                <th className="pr-2 text-left text-[11px] font-normal text-muted">{day}</th>
                {s.values[r].map((v, h) => (
                  <td
                    key={h}
                    title={v == null ? "No trades" : `${day} ${s.colLabels[h]}:00 · ${cellText(v, "money", currency)} · ${s.counts[r][h]} trades`}
                    className="h-7 min-w-7 rounded-sm text-center"
                    style={{ background: v == null ? "var(--nav-active)" : tint(v, max) }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Green is profit, red is loss; darker means a larger amount. Hover a square for the numbers.</p>
    </Card>
  );
}

function YearCalendar({ s, currency }: { s: CalendarSection; currency: string }) {
  const max = Math.max(1, ...Object.values(s.days).map((d) => Math.abs(d.net)));
  return (
    <Card>
      <CardHeader title={s.title} right={`${Object.keys(s.days).length} trading days`} />
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
        {MONTHS.map((name, mi) => {
          const lead = (new Date(Date.UTC(s.year, mi, 1)).getUTCDay() + 6) % 7; // Monday first
          const dim = new Date(Date.UTC(s.year, mi + 1, 0)).getUTCDate();
          return (
            <div key={name}>
              <div className="mb-1 text-xs font-medium text-muted">{name}</div>
              <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`b${i}`} />
                ))}
                {Array.from({ length: dim }, (_, i) => {
                  const date = `${s.year}-${String(mi + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                  const d = s.days[date];
                  return (
                    <span
                      key={date}
                      title={d ? `${date} · ${cellText(d.net, "money", currency)} · ${d.trades} trades` : date}
                      className={cn("flex aspect-square items-center justify-center rounded-sm", d ? "text-ink" : "text-muted/60")}
                      style={d ? { background: tint(d.net, max) } : undefined}
                    >
                      {i + 1}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Text({ s }: { s: { title: string; lines: string[] } }) {
  return (
    <Card>
      <CardHeader title={s.title} />
      <div className="mt-3 space-y-1.5 text-[14px] leading-relaxed">
        {s.lines.map((l, i) =>
          l.endsWith(":") ? (
            <h3 key={i} className="pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
              {l.slice(0, -1)}
            </h3>
          ) : (
            <p key={i}>{l}</p>
          ),
        )}
      </div>
    </Card>
  );
}

/** One section of a report document as a card on the page. */
export function SectionView({ section, currency }: { section: Section; currency: string }) {
  switch (section.kind) {
    case "kv":
      return <Kv s={section} currency={currency} />;
    case "table":
      return <Table s={section} currency={currency} />;
    case "chart":
      return (
        <Card>
          <CardHeader title={section.title} />
          <div className="mt-3">
            <ReportChart section={section} currency={currency} />
          </div>
        </Card>
      );
    case "heatmap":
      return <Heatmap s={section} currency={currency} />;
    case "calendar":
      return <YearCalendar s={section} currency={currency} />;
    case "text":
      return <Text s={section} />;
  }
}

export function ReportView({ doc }: { doc: ReportDoc }) {
  return (
    <div className="space-y-4">
      {doc.sections.map((s, i) => (
        <SectionView key={`${s.kind}-${i}`} section={s} currency={doc.currency} />
      ))}
    </div>
  );
}
