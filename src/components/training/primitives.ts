import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

export interface Band {
  low: number;
  high: number;
  /** "r, g, b" */
  rgb: string;
  alpha?: number;
  label?: string;
  /** chart time (already shifted) where the band starts; omitted = the whole width */
  fromTime?: number;
}

/** Horizontal price bands (the expert's entry zone, a trade's risk and reward) and one dashed vertical line (the decision moment). */
export class TrainingLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<"Candlestick", Time> | null = null;
  private request: (() => void) | null = null;
  private bands: Band[] = [];
  private vline: { time: number; label: string } | null = null;

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<"Candlestick", Time>;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = this.series = this.request = null;
  }
  set(bands: Band[], vline: { time: number; label: string } | null) {
    this.bands = bands;
    this.vline = vline;
    this.request?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "bottom", renderer: () => this.renderer() }];
  }

  private renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        const { chart, series } = this;
        if (!chart || !series) return;
        target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
          for (const b of this.bands) {
            const y0 = series.priceToCoordinate(b.high);
            const y1 = series.priceToCoordinate(b.low);
            if (y0 == null || y1 == null) continue;
            const x0 = b.fromTime != null ? chart.timeScale().timeToCoordinate(b.fromTime as Time) : 0;
            if (x0 == null) continue;
            const left = Math.max(0, x0 * hr);
            c.fillStyle = `rgba(${b.rgb}, ${b.alpha ?? 0.14})`;
            c.fillRect(left, Math.min(y0, y1) * vr, bitmapSize.width - left, Math.max(1, Math.abs(y1 - y0) * vr));
            if (b.label) {
              c.font = `${11 * hr}px system-ui, sans-serif`;
              c.fillStyle = `rgba(${b.rgb}, 0.95)`;
              c.textBaseline = "top";
              c.fillText(b.label, left + 6 * hr, Math.min(y0, y1) * vr + 4 * vr);
            }
          }
          if (this.vline) {
            const x = chart.timeScale().timeToCoordinate(this.vline.time as Time);
            if (x != null) {
              c.save();
              c.strokeStyle = "rgba(224, 176, 78, 0.8)";
              c.lineWidth = Math.max(1, hr);
              c.setLineDash([6 * hr, 4 * hr]);
              c.beginPath();
              c.moveTo(x * hr, 0);
              c.lineTo(x * hr, bitmapSize.height);
              c.stroke();
              c.setLineDash([]);
              c.font = `${11 * hr}px system-ui, sans-serif`;
              c.fillStyle = "rgba(224, 176, 78, 0.95)";
              c.textBaseline = "top";
              c.fillText(this.vline.label, x * hr + 6 * hr, 6 * vr);
              c.restore();
            }
          }
        });
      },
    };
  }
}
