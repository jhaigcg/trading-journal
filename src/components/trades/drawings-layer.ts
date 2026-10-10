import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import { measure, type XY } from "@/lib/drawings/hit";
import type { Drawing, DrawingPoint } from "@/lib/drawings/types";

export interface RulerState {
  a: DrawingPoint;
  b: DrawingPoint;
}

/**
 * Draws the user's own marks on the chart: trend lines, horizontal lines, boxes and notes, plus the ruler.
 * Points are stored in UTC; `shift` converts them to the chart's display-timezone clock.
 */
export class DrawingsLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<"Candlestick", Time> | null = null;
  private request: (() => void) | null = null;
  drawings: Drawing[] = [];
  selectedId: string | null = null;
  /** the shape being placed, following the mouse */
  preview: Drawing | null = null;
  ruler: RulerState | null = null;

  constructor(private shift: number, private stepSec: number) {}

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<"Candlestick", Time>;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = this.series = this.request = null;
  }
  update() {
    this.request?.();
  }
  /** Show these drawings, with one of them selected. */
  sync(drawings: Drawing[], selectedId: string | null) {
    this.drawings = drawings;
    this.selectedId = selectedId;
    this.request?.();
  }

  /** Screen position (CSS pixels) of a chart point, or null when it is off the data. */
  toXY(pt: DrawingPoint): XY | null {
    if (!this.chart || !this.series) return null;
    const x = this.chart.timeScale().timeToCoordinate((pt.t + this.shift) as Time);
    const y = this.series.priceToCoordinate(pt.p);
    return x == null || y == null ? null : { x, y };
  }

  /** Screen points of a drawing for hit testing; a horizontal line needs only its height. */
  screenPoints(d: Drawing): XY[] {
    const pts = d.points.map((p) => this.toXY(p));
    return pts.every((p): p is XY => !!p) ? pts : [];
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => this.renderer() }];
  }

  private renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        if (!this.chart || !this.series) return;
        target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
          const all = this.preview ? [...this.drawings, this.preview] : this.drawings;
          for (const d of all) this.drawOne(c, d, hr, vr, bitmapSize.width, d === this.preview, d.id === this.selectedId);
          if (this.ruler) this.drawRuler(c, this.ruler, hr, vr);
        });
      },
    };
  }

  private drawOne(c: CanvasRenderingContext2D, d: Drawing, hr: number, vr: number, width: number, preview: boolean, selected: boolean) {
    // a horizontal line only needs its price, so it still shows when its starting bar is scrolled out of view
    const pts = d.kind === "hline" ? d.points.map((p) => (this.series?.priceToCoordinate(p.p) == null ? null : { x: 0, y: this.series!.priceToCoordinate(p.p)! })) : d.points.map((p) => this.toXY(p));
    if (!pts.length || pts.some((p) => !p)) return;
    const P = pts as XY[];
    c.save();
    c.globalAlpha = preview ? 0.7 : 1;
    c.strokeStyle = d.color;
    c.fillStyle = d.color;
    c.lineWidth = (selected ? 3 : 2) * hr;
    c.lineCap = "round";
    if (d.kind === "trend" && P.length === 2) {
      c.beginPath();
      c.moveTo(P[0].x * hr, P[0].y * vr);
      c.lineTo(P[1].x * hr, P[1].y * vr);
      c.stroke();
    } else if (d.kind === "hline") {
      c.setLineDash([6 * hr, 4 * hr]);
      c.lineWidth = (selected ? 2 : 1.4) * hr;
      c.beginPath();
      c.moveTo(0, P[0].y * vr);
      c.lineTo(width, P[0].y * vr);
      c.stroke();
      c.setLineDash([]);
      this.label(c, d.points[0].p.toFixed(2), 6 * hr, P[0].y * vr - 10 * vr, d.color, hr, vr, "left");
    } else if (d.kind === "rect" && P.length === 2) {
      const x = Math.min(P[0].x, P[1].x) * hr;
      const y = Math.min(P[0].y, P[1].y) * vr;
      const w = Math.abs(P[1].x - P[0].x) * hr;
      const h = Math.abs(P[1].y - P[0].y) * vr;
      c.globalAlpha = (preview ? 0.7 : 1) * 0.16;
      c.fillRect(x, y, w, h);
      c.globalAlpha = preview ? 0.7 : 1;
      c.lineWidth = (selected ? 2.5 : 1.5) * hr;
      c.strokeRect(x, y, w, h);
    } else if (d.kind === "note") {
      c.beginPath();
      c.arc(P[0].x * hr, P[0].y * vr, 4 * hr, 0, Math.PI * 2);
      c.fill();
      if (d.text) this.label(c, d.text, P[0].x * hr + 8 * hr, P[0].y * vr - 8 * vr, d.color, hr, vr, "left", true);
    }
    if (selected) {
      c.fillStyle = "#0D1015";
      c.strokeStyle = d.color;
      c.lineWidth = 2 * hr;
      for (const p of P) {
        c.beginPath();
        c.rect(p.x * hr - 4 * hr, p.y * vr - 4 * vr, 8 * hr, 8 * vr);
        c.fill();
        c.stroke();
      }
    }
    c.restore();
  }

  private label(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, hr: number, vr: number, align: CanvasTextAlign, boxed = false) {
    c.save();
    c.font = `${11 * hr}px system-ui, sans-serif`;
    c.textAlign = align;
    c.textBaseline = "middle";
    const w = c.measureText(text).width;
    if (boxed) {
      c.fillStyle = "rgba(13,16,21,0.88)";
      c.strokeStyle = color;
      c.lineWidth = hr;
      const left = align === "left" ? x - 4 * hr : align === "center" ? x - w / 2 - 4 * hr : x - w - 4 * hr;
      c.beginPath();
      c.rect(left, y - 9 * vr, w + 8 * hr, 18 * vr);
      c.fill();
      c.stroke();
    }
    c.fillStyle = boxed ? "#E6EAF0" : color;
    c.fillText(text, x, y);
    c.restore();
  }

  private drawRuler(c: CanvasRenderingContext2D, r: RulerState, hr: number, vr: number) {
    const a = this.toXY(r.a);
    const b = this.toXY(r.b);
    if (!a || !b) return;
    const up = r.b.p >= r.a.p;
    const rgb = up ? "61, 211, 154" : "242, 107, 111";
    const x = Math.min(a.x, b.x) * hr;
    const y = Math.min(a.y, b.y) * vr;
    const w = Math.abs(b.x - a.x) * hr;
    const h = Math.abs(b.y - a.y) * vr;
    c.save();
    c.fillStyle = `rgba(${rgb}, 0.16)`;
    c.fillRect(x, y, w, h);
    c.strokeStyle = `rgba(${rgb}, 0.9)`;
    c.lineWidth = hr;
    c.setLineDash([4 * hr, 3 * hr]);
    c.strokeRect(x, y, w, h);
    c.setLineDash([]);
    const m = measure(r.a, r.b, this.stepSec);
    const mins = Math.round(Math.abs(m.seconds) / 60);
    const dur = mins >= 120 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    const text = `${m.diff >= 0 ? "+" : "−"}${Math.abs(m.diff).toFixed(2)} (${m.pct >= 0 ? "+" : "−"}${Math.abs(m.pct).toFixed(2)}%) · ${Math.abs(m.bars)} bars · ${dur}`;
    this.label(c, text, x + w / 2, y + (up ? -14 * vr : h + 14 * vr), `rgb(${rgb})`, hr, vr, "center", true);
    c.restore();
  }
}
