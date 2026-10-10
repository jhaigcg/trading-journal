import { NextResponse } from "next/server";
import { parseFilters } from "@/lib/filters/params";
import { buildReportDoc, isReportTab } from "@/lib/reports/build";
import { docToCsv } from "@/lib/reports/csv";
import { loadNames } from "@/lib/reports/names";
import { parseCharts } from "@/lib/reports/params";
import { docToPdf } from "@/lib/reports/pdf";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

/** Download the report on screen as a PDF or CSV. Takes the same query parameters as the Reports page, plus format=pdf|csv. */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const raw = Object.fromEntries(q.entries());
  const tab = raw.tab;
  const format = raw.format === "csv" ? "csv" : raw.format === "pdf" ? "pdf" : null;
  if (!isReportTab(tab) || !format) return NextResponse.json({ error: "tab and format (pdf or csv) are required" }, { status: 400 });

  const year = Number(raw.year);
  const doc = await buildReportDoc({
    tab,
    filters: parseFilters(raw),
    charts: parseCharts(raw),
    year: Number.isInteger(year) && year >= 1990 && year <= 2100 ? year : undefined,
    names: await loadNames(),
  });
  const stamp = doc.generatedAt.slice(0, 10);
  const name = `ledger-${doc.slug}-${stamp}.${format}`;
  const body = format === "csv" ? docToCsv(doc) : await docToPdf(doc);
  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
