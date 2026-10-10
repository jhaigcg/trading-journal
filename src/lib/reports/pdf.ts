import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { cellText, type Cell, type ChartSection, type CalendarSection, type Col, type HeatmapSection, type KvSection, type ReportDoc, type Section, type TableSection, type TextSection } from "./doc";

const A4: [number, number] = [595.28, 841.89];
const M = 40; // page margin
const CONTENT_W = A4[0] - 2 * M;
const MAX_TABLE_ROWS = 70;

const INK = rgb(0.09, 0.1, 0.12);
const MUTED = rgb(0.4, 0.43, 0.48);
const LINE = rgb(0.85, 0.87, 0.9);
const BAND = rgb(0.96, 0.97, 0.98);
const GOLD = rgb(0.88, 0.69, 0.31);
const GREEN = rgb(0.1, 0.62, 0.43);
const RED = rgb(0.84, 0.27, 0.31);

// ───────────── text that standard PDF fonts can draw ─────────────

const REPLACE: Record<string, string> = { "−": "-", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "“": '"', "”": '"', "‘": "'", "’": "'", " ": " ", "\t": " ", "\n": " ", "\r": " " };

/** Standard PDF fonts only cover Western characters: swap lookalikes, and show "?" for anything else (e.g. Chinese). */
export function pdfSafe(font: PDFFont, s: string): string {
  const set = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of s) {
    const r = REPLACE[ch] ?? ch;
    for (const c of r) out += set.has(c.codePointAt(0)!) ? c : "?";
  }
  return out;
}

/** Shorten to fit `width`. Sanitises first: measuring a character the font cannot encode throws. */
const fit = (font: PDFFont, size: number, raw: string, width: number): string => {
  const s = pdfSafe(font, raw);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
};

function wrap(font: PDFFont, size: number, s: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= width || !line) line = test;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

// ───────────── drawing context ─────────────

class Ctx {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly doc: ReportDoc,
  ) {
    this.newPage(true);
  }

  newPage(first = false) {
    this.page = this.pdf.addPage(A4);
    // brand bar
    this.page.drawRectangle({ x: M, y: A4[1] - 52, width: 16, height: 16, color: GOLD });
    this.text("Ledger.", M + 24, A4[1] - 48, 12, this.bold);
    if (!first) this.text(this.doc.title, A4[0] - M - this.bold.widthOfTextAtSize(pdfSafe(this.bold, this.doc.title), 9), A4[1] - 48, 9, this.regular, MUTED);
    this.y = A4[1] - 78;
  }

  text(s: string, x: number, y: number, size: number, font: PDFFont = this.regular, color: RGB = INK) {
    this.page.drawText(pdfSafe(font, s), { x, y, size, font, color });
  }

  ensure(h: number) {
    if (this.y - h < M + 24) this.newPage();
  }

  heading(title: string) {
    this.ensure(40);
    this.y -= 8;
    this.text(title, M, this.y - 12, 12, this.bold);
    this.page.drawLine({ start: { x: M, y: this.y - 18 }, end: { x: M + CONTENT_W, y: this.y - 18 }, thickness: 0.6, color: LINE });
    this.y -= 28;
  }
}

const toneColor = (unit: Col["unit"] | undefined, v: Cell): RGB => (unit === "money" && typeof v === "number" ? (v > 0 ? GREEN : v < 0 ? RED : INK) : INK);

// ───────────── sections ─────────────

function drawKv(c: Ctx, s: KvSection) {
  c.heading(s.title);
  const colW = (CONTENT_W - 20) / 2;
  const rowH = 17;
  for (let i = 0; i < s.rows.length; i += 2) {
    c.ensure(rowH + 4);
    for (let k = 0; k < 2; k++) {
      const r = s.rows[i + k];
      if (!r) continue;
      const x = M + k * (colW + 20);
      const val = cellText(r.value, r.unit, c.doc.currency) + (r.note ? `  (${r.note})` : "");
      c.text(fit(c.regular, 9, r.label, colW * 0.5), x, c.y - 11, 9, c.regular, MUTED);
      const color = r.tone === "loss" ? RED : r.tone === "pnl" ? toneColor("money", r.value) : INK;
      const shown = fit(c.bold, 9, val, colW * 0.5);
      c.text(shown, x + colW - c.bold.widthOfTextAtSize(pdfSafe(c.bold, shown), 9), c.y - 11, 9, c.bold, color);
      c.page.drawLine({ start: { x, y: c.y - rowH + 2 }, end: { x: x + colW, y: c.y - rowH + 2 }, thickness: 0.4, color: LINE });
    }
    c.y -= rowH;
  }
  c.y -= 6;
}

function drawTable(c: Ctx, s: TableSection) {
  c.heading(s.title);
  const rows = s.rows.slice(0, MAX_TABLE_ROWS);
  const size = 8;
  // column widths from content, then scaled to the page
  const want = s.columns.map((col, i) => {
    const longest = Math.max(c.bold.widthOfTextAtSize(pdfSafe(c.bold, col.label), size), ...rows.map((r) => c.regular.widthOfTextAtSize(pdfSafe(c.regular, cellText(r[i] ?? null, col.unit, c.doc.currency)), size)));
    return Math.min(longest + 10, col.unit && col.unit !== "text" ? 90 : 200);
  });
  const total = want.reduce((a, b) => a + b, 0);
  const scale = Math.min(1.35, CONTENT_W / total);
  const widths = want.map((w) => w * scale);
  const xs = widths.reduce<number[]>((acc, w, i) => [...acc, i === 0 ? M : acc[i - 1] + widths[i - 1]], []);
  const numeric = (col: Col) => !!col.unit && col.unit !== "text";

  const header = () => {
    c.ensure(18);
    c.page.drawRectangle({ x: M, y: c.y - 15, width: CONTENT_W, height: 15, color: BAND });
    s.columns.forEach((col, i) => {
      const label = fit(c.bold, size, col.label, widths[i] - 6);
      const w = c.bold.widthOfTextAtSize(pdfSafe(c.bold, label), size);
      c.text(label, numeric(col) ? xs[i] + widths[i] - 4 - w : xs[i] + 3, c.y - 11, size, c.bold, MUTED);
    });
    c.y -= 15;
  };
  header();
  rows.forEach((r, ri) => {
    if (c.y - 14 < M + 24) {
      c.newPage();
      header();
    }
    if (ri % 2 === 1) c.page.drawRectangle({ x: M, y: c.y - 14, width: CONTENT_W, height: 14, color: rgb(0.985, 0.988, 0.992) });
    s.columns.forEach((col, i) => {
      const unit = s.rowUnits?.[ri] ?? col.unit;
      const txt = fit(c.regular, size, cellText(r[i] ?? null, unit, c.doc.currency), widths[i] - 6);
      const w = c.regular.widthOfTextAtSize(pdfSafe(c.regular, txt), size);
      c.text(txt, numeric(col) || (unit && unit !== "text") ? xs[i] + widths[i] - 4 - w : xs[i] + 3, c.y - 10, size, c.regular, toneColor(unit, r[i] ?? null));
    });
    c.y -= 14;
  });
  if (s.rows.length > rows.length) {
    c.ensure(14);
    c.text(`Showing the first ${rows.length} of ${s.rows.length} rows. Export the CSV for all of them.`, M, c.y - 10, 8, c.regular, MUTED);
    c.y -= 14;
  } else if (s.note) {
    c.ensure(14);
    c.text(s.note, M, c.y - 10, 8, c.regular, MUTED);
    c.y -= 14;
  }
  c.y -= 8;
}

function drawChart(c: Ctx, s: ChartSection) {
  c.heading(s.title);
  const H = 130;
  c.ensure(H + 40);
  const top = c.y;
  const left = M + 36;
  const w = CONTENT_W - 36;
  const n = s.labels.length;
  if (!n) {
    c.text("No data for these filters.", M, top - 12, 9, c.regular, MUTED);
    c.y -= 24;
    return;
  }
  // legend
  s.series.forEach((x, i) => {
    const lx = M + i * 150;
    c.page.drawRectangle({ x: lx, y: top - 9, width: 8, height: 8, color: i === 0 ? GOLD : i === 1 ? rgb(0.35, 0.58, 0.85) : i === 2 ? rgb(0.6, 0.4, 0.8) : MUTED });
    c.text(fit(c.regular, 8, x.label, 130), lx + 12, top - 8, 8, c.regular, MUTED);
  });
  const plotTop = top - 18;
  const plotH = H - 24;
  const plotBottom = plotTop - plotH;

  // each unit gets its own scale so a P&L bar and a win-rate line can share a chart
  const byUnit = new Map<string, number[]>();
  for (const x of s.series) byUnit.set(x.unit, [...(byUnit.get(x.unit) ?? []), ...(x.values.filter((v) => v != null) as number[])]);
  const range = (unit: string) => {
    const v = byUnit.get(unit) ?? [0];
    return { min: Math.min(...v, 0), max: Math.max(...v, 0) || 1 };
  };
  const yOf = (unit: string, v: number) => {
    const { min, max } = range(unit);
    return plotBottom + ((v - min) / (max - min || 1)) * plotH;
  };
  const primary = s.series[0].unit;
  c.page.drawLine({ start: { x: left, y: yOf(primary, 0) }, end: { x: left + w, y: yOf(primary, 0) }, thickness: 0.5, color: LINE });
  const pr = range(primary);
  c.text(cellText(pr.max, primary, c.doc.currency).replace("+", ""), M, plotTop - 6, 7, c.regular, MUTED);
  c.text(cellText(pr.min, primary, c.doc.currency).replace("+", ""), M, plotBottom, 7, c.regular, MUTED);

  const step = w / n;
  s.series.forEach((x, si) => {
    const color = si === 0 ? GOLD : si === 1 ? rgb(0.35, 0.58, 0.85) : si === 2 ? rgb(0.6, 0.4, 0.8) : MUTED;
    if (x.type === "bar") {
      const zero = yOf(x.unit, 0);
      const bw = Math.max(0.6, Math.min(14, step * 0.7));
      x.values.forEach((v, i) => {
        if (v == null) return;
        const y = yOf(x.unit, v);
        c.page.drawRectangle({ x: left + i * step + (step - bw) / 2, y: Math.min(y, zero), width: bw, height: Math.max(0.4, Math.abs(y - zero)), color: x.unit === "money" ? (v >= 0 ? GREEN : RED) : color });
      });
    } else {
      let prev: { x: number; y: number } | null = null;
      x.values.forEach((v, i) => {
        if (v == null) {
          prev = null;
          return;
        }
        const pt = { x: left + i * step + step / 2, y: yOf(x.unit, v) };
        if (prev) c.page.drawLine({ start: prev, end: pt, thickness: 1.2, color });
        prev = pt;
      });
    }
  });
  const xl = (i: number) => c.text(fit(c.regular, 7, s.labels[i], 80), left + i * step, plotBottom - 11, 7, c.regular, MUTED);
  xl(0);
  if (n > 2) xl(Math.floor(n / 2));
  if (n > 1) {
    const last = fit(c.regular, 7, s.labels[n - 1], 80);
    c.text(last, left + w - c.regular.widthOfTextAtSize(pdfSafe(c.regular, last), 7), plotBottom - 11, 7, c.regular, MUTED);
  }
  c.y = plotBottom - 24;
}

/** White blended toward green (profit) or red (loss); the strongest cell in the grid is the deepest colour. */
function mix(v: number, max: number): RGB {
  const t = Math.min(1, Math.abs(v) / (max || 1)) * 0.9;
  const base = v >= 0 ? GREEN : RED;
  return rgb(1 - t * (1 - base.red), 1 - t * (1 - base.green), 1 - t * (1 - base.blue));
}

function drawHeatmap(c: Ctx, s: HeatmapSection) {
  c.heading(s.title);
  const cw = (CONTENT_W - 30) / s.colLabels.length;
  const ch = 16;
  c.ensure(ch * (s.rowLabels.length + 2) + 10);
  const max = Math.max(1, ...s.values.flat().map((v) => Math.abs(v ?? 0)));
  s.colLabels.forEach((l, i) => c.text(l, M + 30 + i * cw + 1, c.y - 9, 6.5, c.regular, MUTED));
  c.y -= 12;
  s.rowLabels.forEach((rl, r) => {
    c.text(rl, M, c.y - 11, 8, c.regular, MUTED);
    s.values[r].forEach((v, i) => c.page.drawRectangle({ x: M + 30 + i * cw, y: c.y - ch + 1, width: cw - 1, height: ch - 1, color: v == null ? BAND : mix(v, max) }));
    c.y -= ch;
  });
  c.y -= 10;
}

function drawCalendar(c: Ctx, s: CalendarSection) {
  c.heading(s.title);
  const days = Object.entries(s.days);
  const max = Math.max(1, ...days.map(([, v]) => Math.abs(v.net)));
  const cell = Math.min(9, (CONTENT_W - 20) / 54);
  c.ensure(cell * 7 + 40);
  const start = new Date(Date.UTC(s.year, 0, 1));
  const offset = (start.getUTCDay() + 6) % 7; // Monday = row 0
  const gridTop = c.y - 12;
  let lastMonth = -1;
  for (let d = 0; d < 366; d++) {
    const date = new Date(Date.UTC(s.year, 0, 1 + d));
    if (date.getUTCFullYear() !== s.year) break;
    const col = Math.floor((d + offset) / 7);
    const row = (d + offset) % 7;
    const key = date.toISOString().slice(0, 10);
    const v = s.days[key];
    if (date.getUTCMonth() !== lastMonth && row < 7) {
      lastMonth = date.getUTCMonth();
      c.text(date.toLocaleString("en-AU", { month: "short", timeZone: "UTC" }), M + 20 + col * (cell + 1), c.y - 8, 6.5, c.regular, MUTED);
    }
    c.page.drawRectangle({ x: M + 20 + col * (cell + 1), y: gridTop - row * (cell + 1) - cell, width: cell, height: cell, color: v ? mix(v.net, max) : BAND });
  }
  ["Mon", "Wed", "Fri"].forEach((l, i) => c.text(l, M, gridTop - (i * 2) * (cell + 1) - cell + 1, 6, c.regular, MUTED));
  c.y = gridTop - 7 * (cell + 1) - 10;
}

function drawText(c: Ctx, s: TextSection) {
  c.heading(s.title);
  const size = 9.5;
  for (const line of s.lines) {
    const heading = line.endsWith(":"); // a line ending in a colon introduces the lines below it
    const font = heading ? c.bold : c.regular;
    const parts = wrap(font, size, pdfSafe(font, line), CONTENT_W - 16);
    c.ensure(parts.length * 13 + 4);
    parts.forEach((p, i) => c.text(heading ? p : i === 0 ? `- ${p}` : `  ${p}`, M + (heading ? 0 : 6), c.y - 10 - i * 13, size, font));
    c.y -= parts.length * 13 + 2;
  }
  c.y -= 6;
}

const DRAW: Record<Section["kind"], (c: Ctx, s: never) => void> = {
  kv: drawKv as (c: Ctx, s: never) => void,
  table: drawTable as (c: Ctx, s: never) => void,
  chart: drawChart as (c: Ctx, s: never) => void,
  heatmap: drawHeatmap as (c: Ctx, s: never) => void,
  calendar: drawCalendar as (c: Ctx, s: never) => void,
  text: drawText as (c: Ctx, s: never) => void,
};

/** Render a report to a PDF (A4, portrait). Tables continue across pages; very long tables are cut with a pointer to the CSV. */
export async function docToPdf(doc: ReportDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setCreator("Ledger.");
  pdf.setProducer("Ledger.");
  pdf.setCreationDate(new Date(doc.generatedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c = new Ctx(pdf, regular, bold, doc);

  c.text(doc.title, M, c.y - 8, 20, bold);
  c.y -= 26;
  for (const line of wrap(regular, 9.5, pdfSafe(regular, doc.subtitle), CONTENT_W)) {
    c.text(line, M, c.y - 8, 9.5, regular, MUTED);
    c.y -= 13;
  }
  c.y -= 4;

  for (const s of doc.sections) DRAW[s.kind](c, s as never);

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `${doc.currency} · generated ${new Date(doc.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC · page ${i + 1} of ${pages.length}`;
    p.drawText(pdfSafe(regular, label), { x: M, y: M - 6, size: 7.5, font: regular, color: MUTED });
  });
  return pdf.save();
}
