/**
 * Report documents built from the seeded demo account. Skipped automatically if the demo data is absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters/params";
import { REPORT_TABS, buildReportDoc, previousRange, recapLines } from "@/lib/reports/build";
import { docToCsv } from "@/lib/reports/csv";
import { DEFAULT_CHARTS } from "@/lib/reports/params";
import { docToPdf } from "@/lib/reports/pdf";
import { emptyAgg } from "@/lib/reports/rollup";
import { summaryFromAggregates } from "@/lib/metrics";
import { PDFDocument } from "pdf-lib";

let accountId = "";
let ready = false;
const F = (extra: Record<string, string> = {}) => parseFilters({ account: accountId, range: "all", ...extra });
const now = new Date("2026-10-10T06:00:00Z");

beforeAll(async () => {
  try {
    const acc = await db.account.findFirst({ where: { name: { startsWith: "MT4 · Main account (demo data)" } } });
    if (acc) {
      accountId = acc.id;
      ready = (await db.trade.count({ where: { accountId, status: "CLOSED" } })) > 100;
    }
  } catch {
    ready = false;
  }
});
afterAll(async () => {
  await db.$disconnect();
});

describe("previousRange", () => {
  it("is the same number of days ending the day before", () => {
    expect(previousRange({ from: "2026-10-01", to: "2026-10-10" })).toEqual({ from: "2026-09-21", to: "2026-09-30" });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-01" })).toEqual({ from: "2026-02-28", to: "2026-02-28" });
    expect(previousRange({ from: "2026-01-01", to: "2026-12-31" })).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("is null for an open-ended range", () => {
    expect(previousRange({ from: null, to: null })).toBeNull();
    expect(previousRange({ from: "2026-01-01", to: null })).toBeNull();
  });
});

describe("recapLines", () => {
  const agg = (net: number, wins: number, losses: number) => ({ ...emptyAgg(), count: wins + losses, wins, losses, netPnl: net, grossPnl: net, grossWin: net > 0 ? net : 0, grossLoss: net < 0 ? net : 0 });
  const c = { thr: 0, currency: "AUD", m: (v: number) => v };
  const bd = (key: string, label: string, net: number) => ({ key, label, summary: summaryFromAggregates(agg(net, net > 0 ? 1 : 0, net < 0 ? 1 : 0)), agg: agg(net, 1, 0) });

  it("says there is nothing to say when there are no trades", () => {
    expect(recapLines([], c, [], [], [], { noStop: 0, total: 0 })).toEqual(["No closed trades in this period."]);
  });

  it("reports totals, best and worst day and the strongest groups", () => {
    const rows = [
      { day: "2026-10-05", agg: agg(100, 2, 0) },
      { day: "2026-10-06", agg: agg(-250, 0, 2) },
      { day: "2026-10-07", agg: agg(40, 1, 0) },
    ];
    const lines = recapLines(rows, c, [bd("1", "Mon", 100), bd("2", "Tue", -250)], [bd("9", "09", 140), bd("10", "10", -250)], [bd("a", "Key reversal", 140), bd("none", "No playbook", -250)], { noStop: 2, total: 5 });
    const text = lines.join("\n");
    expect(text).toContain("5 trades over 3 trading days, net −A$110.00");
    expect(text).toContain("2 green days and 1 red day");
    expect(text).toContain("Best day: Mon 5 Oct 2026, +A$100.00");
    expect(text).toContain("Worst day: Tue 6 Oct 2026, −A$250.00");
    expect(text).toContain("Strongest weekday: Mon");
    expect(text).toContain("Weakest: Tue");
    expect(text).toContain("Best playbook: Key reversal");
    expect(text).toContain("2 of 5 trades had no stop loss.");
  });
});

describe("report documents", () => {
  it("every tab builds, exports to CSV and renders as a PDF", async (ctx) => {
    if (!ready) return ctx.skip();
    for (const tab of REPORT_TABS) {
      const doc = await buildReportDoc({ tab: tab.id, filters: F({ range: "30d" }), charts: DEFAULT_CHARTS, now });
      expect(doc.slug, tab.id).toBe(tab.id);
      expect(doc.sections.length, tab.id).toBeGreaterThan(0);
      expect(doc.subtitle).toContain("30 days");
      const csv = docToCsv(doc);
      expect(csv.length, tab.id).toBeGreaterThan(20);
      const pdf = await docToPdf(doc);
      expect((await PDFDocument.load(pdf)).getPageCount(), tab.id).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);

  it("the overview numbers match the database", async (ctx) => {
    if (!ready) return ctx.skip();
    const doc = await buildReportDoc({ tab: "overview", filters: F(), charts: DEFAULT_CHARTS, now });
    const kv = doc.sections.find((s) => s.kind === "kv");
    if (kv?.kind !== "kv") throw new Error("no summary");
    const net = kv.rows.find((r) => r.label === "Net P&L")?.value as number;
    const real = await db.trade.aggregate({ where: { accountId, status: "CLOSED" }, _sum: { netPnl: true } });
    expect(net).toBeCloseTo(Number(real._sum.netPnl), 1);
    const equity = doc.sections.find((s) => s.kind === "chart" && s.title === "Cumulative net P&L");
    if (equity?.kind !== "chart") throw new Error("no equity chart");
    const last = [...equity.series[0].values].reverse().find((v) => v != null) as number;
    expect(last).toBeCloseTo(net, 1);
  });

  it("breakdown tables add up to the overall total (except tags, which overlap by design)", async (ctx) => {
    if (!ready) return ctx.skip();
    const overview = await buildReportDoc({ tab: "overview", filters: F(), charts: DEFAULT_CHARTS, now });
    const kv = overview.sections.find((s) => s.kind === "kv");
    if (kv?.kind !== "kv") throw new Error("no summary");
    const net = kv.rows.find((r) => r.label === "Net P&L")?.value as number;
    for (const tab of ["symbols", "playbooks"] as const) {
      const doc = await buildReportDoc({ tab, filters: F(), charts: DEFAULT_CHARTS, now });
      const t = doc.sections.find((s) => s.kind === "table");
      if (t?.kind !== "table") throw new Error("no table");
      const col = t.columns.findIndex((x) => x.key === "net");
      const total = t.rows.reduce((s, r) => s + Number(r[col]), 0);
      expect(total, tab).toBeCloseTo(net, 0);
    }
  });

  it("compare uses the period before, and says so when the range is open", async (ctx) => {
    if (!ready) return ctx.skip();
    const open = await buildReportDoc({ tab: "compare", filters: F(), charts: DEFAULT_CHARTS, now });
    expect(open.sections[0].kind).toBe("text");
    const doc = await buildReportDoc({ tab: "compare", filters: F({ range: "30d" }), charts: DEFAULT_CHARTS, now });
    const t = doc.sections[0];
    if (t.kind !== "table") throw new Error("no table");
    expect(t.title).toContain("compared with");
    expect(t.rowUnits?.length).toBe(t.rows.length);
    const row = t.rows.find((r) => r[0] === "Net P&L")!;
    expect(row[3]).toBeCloseTo(Number(row[1]) - Number(row[2]), 1);
  });

  it("calendar covers the requested year", async (ctx) => {
    if (!ready) return ctx.skip();
    const year = Number((await db.trade.findFirst({ where: { accountId, status: "CLOSED" }, orderBy: { closedAt: "desc" } }))!.closeDay!.toISOString().slice(0, 4));
    const doc = await buildReportDoc({ tab: "calendar", filters: F(), charts: DEFAULT_CHARTS, year, now });
    const cal = doc.sections[0];
    if (cal.kind !== "calendar") throw new Error("no calendar");
    expect(cal.year).toBe(year);
    expect(Object.keys(cal.days).every((d) => d.startsWith(String(year)))).toBe(true);
    expect(Object.keys(cal.days).length).toBeGreaterThan(0);
  });
});
