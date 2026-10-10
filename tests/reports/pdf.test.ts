import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ReportDoc } from "@/lib/reports/doc";
import { docToPdf, pdfSafe } from "@/lib/reports/pdf";
import { pdfText } from "../helpers/pdf-text";

const base = (sections: ReportDoc["sections"]): ReportDoc => ({ slug: "t", title: "Performance report", subtitle: "All accounts · 1 Oct – 31 Oct 2026 · Short only", currency: "AUD", generatedAt: "2026-10-10T06:00:00Z", sections });
const days = Array.from({ length: 200 }, (_, i) => `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`);

const full = base([
  { kind: "kv", title: "Summary", rows: [{ label: "Net P&L", unit: "money", value: 3650.2, tone: "pnl" }, { label: "Win %", unit: "pct", value: 58.9, note: "3 W · 2 L" }, { label: "Max daily net drawdown", unit: "money", value: -3995.44, tone: "loss" }, { label: "Profit factor", unit: "ratio", value: null }] },
  { kind: "table", title: "Days", columns: [{ key: "d", label: "Date" }, { key: "t", label: "Trades", unit: "count" }, { key: "n", label: "Net P&L", unit: "money" }], rows: days.map((d, i) => [d, i % 20, (i % 7 - 3) * 41.5]) },
  { kind: "chart", title: "Cumulative net P&L", axis: "Day", labels: days.slice(0, 30), series: [{ key: "a", label: "Cumulative net P&L", unit: "money", type: "line", values: days.slice(0, 30).map((_, i) => i * 10 - 80) }, { key: "b", label: "Win %", unit: "pct", type: "line", values: days.slice(0, 30).map((_, i) => (i % 5 === 0 ? null : 40 + (i % 9))) }] },
  { kind: "chart", title: "Net by week", axis: "Week", labels: ["w1", "w2", "w3"], series: [{ key: "n", label: "Net P&L", unit: "money", type: "bar", values: [120, -80, 40] }] },
  { kind: "heatmap", title: "Net P&L by weekday and hour", rowLabels: ["Mon", "Tue"], colLabels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")), values: [Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? null : (i - 12) * 10)), Array.from({ length: 24 }, () => 5)], counts: [[], []] },
  { kind: "calendar", title: "2026", year: 2026, days: { "2026-01-05": { net: 120, trades: 4 }, "2026-10-09": { net: -75, trades: 9 }, "2026-12-31": { net: 10, trades: 1 } } },
  { kind: "text", title: "Highlights", lines: ["Best day: Thu 8 Oct, +A$1,860", "Watch-outs:", "5 trades had no stop loss and a long line that has to wrap across more than one line of the page because it keeps going and going"] },
]);

describe("docToPdf", () => {
  it("produces a valid multi-page PDF with every section kind", async () => {
    const bytes = await docToPdf(full);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(2); // 200-row table cut at 70 rows still spills over a page
    expect(reloaded.getTitle()).toBe("Performance report");
    expect(bytes.length).toBeGreaterThan(3000);
    const text = pdfText(bytes);
    const all = text.join("|");
    for (const expected of ["Performance report", "Summary", "Net P&L", "+A$3,650.20", "-A$3,995.44", "58.9%  (3 W · 2 L)", "Cumulative net P&L", "Net by week", "Net P&L by weekday and hour", "Highlights", "Watch-outs:"]) expect(all).toContain(expected);
    expect(text.some((t) => t.startsWith("generated") || t.includes("page 1 of"))).toBe(true);
  });

  it("copes with text the standard fonts cannot draw (Chinese, minus signs, arrows) instead of failing", async () => {
    const doc = base([
      { kind: "table", title: "标签 tags → by playbook", columns: [{ key: "n", label: "名称" }, { key: "v", label: "Net", unit: "money" }], rows: [["流动性扫荡 → CHoCH", -12.5], ["Key reversal – 5M", 3]] },
      { kind: "text", title: "Notes", lines: ["中文 text with “quotes” and a − sign ≥ 3"] },
    ]);
    const bytes = await docToPdf(doc);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("an empty report is still a valid one-page PDF", async () => {
    const bytes = await docToPdf(base([{ kind: "chart", title: "Nothing", axis: "Day", labels: [], series: [{ key: "n", label: "Net", unit: "money", type: "bar", values: [] }] }, { kind: "table", title: "Empty", columns: [{ key: "a", label: "A" }], rows: [] }]));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("tells the reader when a long table was cut", async () => {
    const bytes = await docToPdf(base([{ kind: "table", title: "Days", columns: [{ key: "d", label: "Date" }], rows: days.map((d) => [d]) }]));
    expect(pdfText(bytes)).toContain("Showing the first 70 of 200 rows. Export the CSV for all of them.");
  });
});

describe("pdfSafe", () => {
  it("swaps lookalikes and replaces the unprintable", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    expect(pdfSafe(font, "−A$5 → ok")).toBe("-A$5 -> ok");
    expect(pdfSafe(font, "5M · CHoCH – BOS")).toBe("5M · CHoCH – BOS");
    expect(pdfSafe(font, "中文")).toBe("??");
    expect(pdfSafe(font, "a\nb\tc")).toBe("a b c");
  });
});
