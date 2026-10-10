import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/layout/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { ChartConfigBar } from "@/components/reports/chart-config";
import { ReportView, SectionView } from "@/components/reports/section-view";
import { cn } from "@/lib/cn";
import { parseFilters } from "@/lib/filters/params";
import { REPORT_TABS, buildReportDoc, isReportTab } from "@/lib/reports/build";
import { loadNames } from "@/lib/reports/names";
import { addableMetrics, parseCharts } from "@/lib/reports/params";
import { loadFilterOptions } from "@/lib/queries/options";

export const metadata: Metadata = { title: "Reports" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tab = isReportTab(first(sp.tab)) ? (first(sp.tab) as (typeof REPORT_TABS)[number]["id"]) : "overview";
  const filters = parseFilters(sp);
  const charts = parseCharts(sp);
  const yearParam = Number(first(sp.year));
  const year = Number.isInteger(yearParam) && yearParam >= 1990 && yearParam <= 2100 ? yearParam : undefined;

  const [options, names] = await Promise.all([loadFilterOptions(), loadNames()]);
  const doc = await buildReportDoc({ tab, filters, charts, year, names });

  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "tab") q.set(k, v);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q;
  };
  const tabHref = (id: string) => `/reports?${keep({ tab: id })}`;
  const exportHref = (format: "pdf" | "csv") => `/api/reports/export?${keep({ tab, format })}`;
  const calYear = doc.sections.find((s) => s.kind === "calendar")?.kind === "calendar" ? (doc.sections[0] as { year: number }).year : null;

  return (
    <>
      <PageHeader title="Reports">
        <Suspense>
          <FilterBar options={options}>
            <a href={exportHref("pdf")} className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line-strong px-3.5 text-[13px] hover:bg-nav-active">
              <Download size={14} aria-hidden /> PDF
            </a>
            <a href={exportHref("csv")} className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line-strong px-3.5 text-[13px] hover:bg-nav-active">
              <Download size={14} aria-hidden /> CSV
            </a>
          </FilterBar>
        </Suspense>
      </PageHeader>

      <nav aria-label="Report" className="mb-3 flex gap-0.5 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {REPORT_TABS.map((t) => (
          <Link key={t.id} href={tabHref(t.id)} aria-current={t.id === tab ? "page" : undefined} className={cn("-mb-px flex min-h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-2.5 text-[13px]", t.id === tab ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </nav>

      <p className="mb-4 text-xs text-muted">
        {doc.subtitle}. Closed trades only, shown in {doc.currency}.
      </p>

      {calYear != null && (
        <div className="mb-3 flex items-center gap-1">
          <Link href={`/reports?${keep({ tab, year: String(calYear - 1) })}`} aria-label="Previous year" className="flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-ink">
            <ChevronLeft size={16} aria-hidden />
          </Link>
          <span className="num min-w-12 text-center text-sm font-semibold">{calYear}</span>
          <Link href={`/reports?${keep({ tab, year: String(calYear + 1) })}`} aria-label="Next year" className="flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-ink">
            <ChevronRight size={16} aria-hidden />
          </Link>
        </div>
      )}

      {tab === "performance" ? (
        <div className="space-y-4">
          {doc.sections.map((s, i) => (
            <div key={i}>
              {i < 2 && (
                <Suspense>
                  <ChartConfigBar n={(i + 1) as 1 | 2} metrics={charts[i].metrics} g={charts[i].g} addable={addableMetrics(charts[i].metrics)} />
                </Suspense>
              )}
              <SectionView section={s} currency={doc.currency} />
            </div>
          ))}
        </div>
      ) : (
        <ReportView doc={doc} />
      )}
    </>
  );
}
