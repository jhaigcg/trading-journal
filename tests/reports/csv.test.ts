import { describe, expect, it } from "vitest";
import { cellText, sectionAsTable, type ReportDoc } from "@/lib/reports/doc";
import { csvLine, docToCsv, safeText } from "@/lib/reports/csv";

describe("CSV safety and format", () => {
  it("neutralises anything a spreadsheet would run as a formula", () => {
    for (const bad of ["=HYPERLINK(\"http://evil\",\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(safeText(bad).startsWith("'")).toBe(true);
    expect(safeText("XAUUSD")).toBe("XAUUSD");
    expect(safeText("Key reversal – 5M")).toBe("Key reversal – 5M");
  });

  it("writes numbers as numbers (a negative P&L is not a formula) and text as text", () => {
    expect(csvLine(["a", -12.5, 3, null])).toBe("a,-12.5,3,");
    expect(csvLine(["-12.5"])).toBe("'-12.5"); // the same characters as text are protected
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvLine(["a,b", 'say "hi"', "line1\nline2"])).toBe('"a,b","say ""hi""","line1\nline2"');
    expect(csvLine([NaN, Infinity])).toBe(",");
  });

  const doc: ReportDoc = {
    slug: "test",
    title: "Test report",
    subtitle: "All accounts · this month",
    currency: "AUD",
    generatedAt: "2026-10-10T00:00:00Z",
    sections: [
      { kind: "kv", title: "Summary", rows: [{ label: "Net P&L", unit: "money", value: 123.45 }, { label: "Win %", unit: "pct", value: 58.9, note: "3 W · 2 L" }] },
      { kind: "table", title: "By symbol", columns: [{ key: "s", label: "Symbol" }, { key: "n", label: "Net", unit: "money" }], rows: [["XAUUSD", 100], ["=EVIL()", -5]] },
      { kind: "chart", title: "Curve", axis: "Day", labels: ["2026-10-01", "2026-10-02"], series: [{ key: "net", label: "Net P&L", unit: "money", type: "bar", values: [10, null] }] },
      { kind: "heatmap", title: "Heat", rowLabels: ["Mon"], colLabels: ["09", "10"], values: [[5, null]], counts: [[1, 0]] },
      { kind: "calendar", title: "Year", year: 2026, days: { "2026-10-02": { net: 4, trades: 2 }, "2026-10-01": { net: -1, trades: 1 } } },
      { kind: "text", title: "Notes", lines: ["Line one", "中文标签"] },
    ],
  };

  it("renders every kind of section and starts with a byte-order mark", () => {
    const csv = docToCsv(doc);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines.slice(0, 3)).toEqual(["Test report", "All accounts · this month", "Currency: AUD"]);
    expect(lines).toContain("Metric,Value,Note");
    expect(lines).toContain("Net P&L,123.45,");
    expect(lines).toContain("Win %,58.9,3 W · 2 L");
    expect(lines).toContain("XAUUSD,100");
    expect(lines).toContain("'=EVIL(),-5"); // protected
    expect(lines).toContain("Day,Net P&L");
    expect(lines).toContain("2026-10-01,10");
    expect(lines).toContain("2026-10-02,"); // a missing value becomes an empty cell
    expect(lines).toContain(",09,10");
    expect(lines).toContain("Mon,5,");
    expect(lines.indexOf("Date,Net P&L,Trades")).toBeGreaterThan(0);
    expect(lines.indexOf("2026-10-01,-1,1")).toBeLessThan(lines.indexOf("2026-10-02,4,2")); // calendar days sorted
    expect(lines).toContain("中文标签");
  });

  it("sections convert to tables for the other renderers too", () => {
    const t = sectionAsTable(doc.sections[2], "AUD")!;
    expect(t.header).toEqual(["Day", "Net P&L"]);
    expect(t.rows).toEqual([["2026-10-01", 10], ["2026-10-02", null]]);
  });

  it("cell text follows the unit", () => {
    expect(cellText(12.5, "money", "AUD")).toBe("+A$12.50");
    expect(cellText(58.93, "pct", "AUD")).toBe("58.9%");
    expect(cellText(null, "money", "AUD")).toBe("—");
    expect(cellText("XAUUSD", "money", "AUD")).toBe("XAUUSD");
    expect(cellText(7, undefined, "AUD")).toBe("7");
  });
});
