import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { NO_OVERLAYS, type Overlays } from "@/lib/smc";

// LuxAlgo palette: order blocks (internal lighter, swing darker), and fair value gaps in the same green and red as structure
const FVG = { bull: "8, 153, 129", bear: "242, 54, 69" };
const OB = { internalBull: "49, 121, 245", internalBear: "247, 124, 128", swingBull: "24, 72, 204", swingBear: "178, 40, 51" };
const BULL = "8, 153, 129";
const BEAR = "242, 54, 69";

/**
 * Smart-money overlays: fair value gaps and order blocks as shaded boxes (under the candles), and BOS / CHoCH lines,
 * equal highs / lows and the strong / weak high and low as lines and labels (over them). Order blocks run from where they
 * formed to the right edge while they stand; a fair value gap is a box of fixed length, as in the LuxAlgo indicator.
 */
export class ZonesLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<"Candlestick", Time> | null = null;
  private request: (() => void) | null = null;
  private o: Overlays = NO_OVERLAYS;

  /** `shift` is added to every time so the overlays line up with a chart drawn in the display timezone */
  constructor(private shift = 0) {}

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<"Candlestick", Time>;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = this.series = this.request = null;
  }
  set(overlays: Overlays) {
    this.o = overlays;
    this.request?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [
      { zOrder: () => "bottom", renderer: () => this.boxes() },
      { zOrder: () => "top", renderer: () => this.lines() },
    ];
  }

  private idx(i: number): number | null {
    return this.chart ? this.chart.timeScale().logicalToCoordinate(i as Logical) : null;
  }

  private x(t: number): number | null {
    return this.chart ? this.chart.timeScale().timeToCoordinate((t + this.shift) as Time) : null;
  }

  private boxes(): IPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        const { series } = this;
        if (!series || this.o.zones.length === 0) return;
        target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
          for (const z of this.o.zones) {
            const y0 = series.priceToCoordinate(z.top);
            const y1 = series.priceToCoordinate(z.bottom);
            const byIdx = z.startIdx != null && z.endIdx != null;
            const xs = byIdx ? this.idx(z.startIdx as number) : this.x(z.startT);
            if (y0 == null || y1 == null || xs == null) continue;
            const xe = byIdx ? this.idx(z.endIdx as number) : z.endT == null ? null : this.x(z.endT);
            const left = Math.max(0, xs * hr);
            const right = xe == null ? bitmapSize.width : Math.min(bitmapSize.width, xe * hr);
            if (right <= left) continue;
            const top = Math.min(y0, y1) * vr;
            const h = Math.max(1, Math.abs(y1 - y0) * vr);
            const rgb = z.kind === "FVG" ? FVG[z.side] : z.internal ? (z.side === "bull" ? OB.internalBull : OB.internalBear) : z.side === "bull" ? OB.swingBull : OB.swingBear;
            c.fillStyle = `rgba(${rgb}, ${z.kind === "OB" ? 0.2 : 0.3})`;
            c.fillRect(left, top, right - left, h);
            if (z.kind === "OB" && !z.internal) {
              c.strokeStyle = `rgba(${rgb}, 0.8)`;
              c.lineWidth = Math.max(1, hr);
              c.strokeRect(left, top, right - left, h);
            }
            if (z.kind === "OB" && right - left > 28 * hr && h > 11 * vr) {
              c.font = `${10 * hr}px system-ui, sans-serif`;
              c.fillStyle = `rgba(${z.kind === "OB" ? (z.side === "bull" ? "127, 183, 240" : "247, 124, 128") : rgb}, 0.95)`;
              c.textBaseline = "top";
              c.fillText(z.kind, left + 4 * hr, top + 2 * vr);
            }
          }
        });
      },
    };
  }

  private lines(): IPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        const { series } = this;
        const { structure, eq, trailing } = this.o;
        if (!series || (structure.length === 0 && eq.length === 0 && !trailing)) return;
        target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
          const text = (label: string, x: number, y: number, rgb: string, px: number, above: boolean) => {
            c.font = `${px * hr}px system-ui, sans-serif`;
            c.fillStyle = `rgba(${rgb}, 1)`;
            c.textAlign = "center";
            c.textBaseline = above ? "bottom" : "top";
            c.fillText(label, x, y + (above ? -3 : 3) * vr);
          };
          const seg = (x0: number, x1: number, y: number, rgb: string, dash: number[]) => {
            c.beginPath();
            c.strokeStyle = `rgba(${rgb}, 1)`;
            c.lineWidth = Math.max(1, hr);
            c.setLineDash(dash.map((d) => d * hr));
            c.moveTo(x0, y);
            c.lineTo(x1, y);
            c.stroke();
            c.setLineDash([]);
          };

          for (const e of structure) {
            const y = series.priceToCoordinate(e.level);
            const xa = this.x(e.fromT);
            const xb = this.x(e.toT);
            const xm = this.x(e.midT);
            if (y == null || xa == null || xb == null || xm == null) continue;
            const rgb = e.bias === "bull" ? BULL : BEAR;
            seg(xa * hr, xb * hr, y * vr, rgb, e.internal ? [4, 3] : []);
            text(e.tag, xm * hr, y * vr, rgb, e.internal ? 9 : 11, e.bias === "bull");
          }

          for (const e of eq) {
            const ya = series.priceToCoordinate(e.fromLevel);
            const yb = series.priceToCoordinate(e.toLevel);
            const xa = this.x(e.fromT);
            const xb = this.x(e.toT);
            const xm = this.x(e.midT);
            if (ya == null || yb == null || xa == null || xb == null || xm == null) continue;
            const rgb = e.kind === "EQH" ? BEAR : BULL;
            c.beginPath();
            c.strokeStyle = `rgba(${rgb}, 1)`;
            c.lineWidth = Math.max(1, hr);
            c.setLineDash([1 * hr, 3 * hr]);
            c.moveTo(xa * hr, ya * vr);
            c.lineTo(xb * hr, yb * vr);
            c.stroke();
            c.setLineDash([]);
            text(e.kind, xm * hr, ((ya + yb) / 2) * vr, rgb, 9, e.kind === "EQH");
          }

          if (trailing) {
            const draw = (price: number | null, t: number | null, rgb: string, label: string, above: boolean) => {
              if (price == null || t == null) return;
              const y = series.priceToCoordinate(price);
              const x = this.x(t);
              if (y == null || x == null) return;
              seg(Math.max(0, x * hr), bitmapSize.width, y * vr, rgb, []);
              c.font = `${9 * hr}px system-ui, sans-serif`;
              c.fillStyle = `rgba(${rgb}, 1)`;
              c.textAlign = "right";
              c.textBaseline = above ? "bottom" : "top";
              c.fillText(label, bitmapSize.width - 6 * hr, y * vr + (above ? -3 : 3) * vr);
            };
            draw(trailing.top, trailing.topT, BEAR, trailing.trend === "bear" ? "Strong High" : "Weak High", true);
            draw(trailing.bottom, trailing.bottomT, BULL, trailing.trend === "bull" ? "Strong Low" : "Weak Low", false);
          }
        });
      },
    };
  }
}
