import { sectionAsTable, type Cell, type ReportDoc } from "./doc";

/**
 * Text that a spreadsheet would run as a formula (starts with = + - @ or a tab/return) is prefixed with an
 * apostrophe so opening an export can never execute anything. Real numbers are written as numbers and untouched.
 */
export function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function field(cell: Cell): string {
  if (cell == null) return "";
  const text = typeof cell === "number" ? (Number.isFinite(cell) ? String(cell) : "") : safeText(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (cells: Cell[]) => cells.map(field).join(",");

/**
 * One CSV with a block per section (title row, header row, data rows, blank line). A UTF-8 byte-order mark makes
 * Excel read non-English text (such as Chinese tag names) correctly.
 */
export function docToCsv(doc: ReportDoc): string {
  const lines: string[] = [csvLine([doc.title]), csvLine([doc.subtitle]), csvLine([`Currency: ${doc.currency}`]), ""];
  for (const s of doc.sections) {
    const t = sectionAsTable(s, doc.currency);
    if (!t) continue;
    lines.push(csvLine([t.title]), csvLine(t.header), ...t.rows.map(csvLine), "");
  }
  return "﻿" + lines.join("\r\n");
}
