import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

export interface PositionBoxInput {
  /** chart times (already shifted for the display timezone) of the entry and exit candles; exit null = still open */
  openTime: number;
  closeTime: number | null;
  /** time of the last candle, where an open trade's box ends */
  lastTime: number;
  side: "LONG" | "SHORT";
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
}

const GREEN = "61, 211, 154";
const RED = "242, 107, 111";
const BLUE = "127, 183, 240";

/**
 * Draws the trade on the chart as a position box, like a trading platform does: a tinted rectangle from the entry price to
 * the exit price over the time the trade was open (green for a profit, red for a loss), fainter risk and reward zones out to
 * the stop and the target, and a dashed vertical line at the entry and at the exit.
 */
export class PositionBox implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<"Candlestick", Time> | null = null;
  private request: (() => void) | null = null;
  visible = true;

  constructor(private input: PositionBoxInput) {}

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<"Candlestick", Time>;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = this.series = this.request = null;
  }
  setVisible(v: boolean) {
    this.visible = v;
    this.request?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "bottom", renderer: () => this.renderer() }];
  }

  private renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        if (!this.visible || !this.chart || !this.series) return;
        const { chart, series, input: t } = this;
        const ts = chart.timeScale();
        const x0 = ts.timeToCoordinate(t.openTime as Time);
        const x1 = ts.timeToCoordinate((t.closeTime ?? t.lastTime) as Time);
        if (x0 == null || x1 == null) return;
        const y = (price: number | null) => (price == null ? null : series.priceToCoordinate(price));
        const yEntry = y(t.entry);
        if (yEntry == null) return;
        const win = t.exit == null ? null : t.side === "LONG" ? t.exit > t.entry : t.exit < t.entry;

        target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
          const left = Math.min(x0, x1) * hr;
          const width = Math.max(Math.abs(x1 - x0) * hr, 2);
          const rect = (yA: number, yB: number, rgb: string, alpha: number) => {
            c.fillStyle = `rgba(${rgb}, ${alpha})`;
            c.fillRect(left, Math.min(yA, yB) * vr, width, Math.abs(yB - yA) * vr || 1);
          };

          // risk and reward zones, faint
          const yStop = y(t.stopLoss);
          const yTarget = y(t.profitTarget);
          if (yStop != null) rect(yEntry, yStop, RED, 0.1);
          if (yTarget != null) rect(yEntry, yTarget, GREEN, 0.1);

          // entry-to-exit result box
          const yExit = y(t.exit);
          if (yExit != null && win != null) {
            const rgb = win ? GREEN : RED;
            rect(yEntry, yExit, rgb, 0.24);
            c.strokeStyle = `rgba(${rgb}, 0.9)`;
            c.lineWidth = Math.max(1, hr);
            c.strokeRect(left, Math.min(yEntry, yExit) * vr, width, Math.abs(yExit - yEntry) * vr || 1);
          }

          // entry line across the box, and dashed verticals at the entry and the exit
          c.strokeStyle = `rgba(${BLUE}, 0.95)`;
          c.lineWidth = Math.max(1, hr);
          c.beginPath();
          c.moveTo(left, yEntry * vr);
          c.lineTo(left + width, yEntry * vr);
          c.stroke();
          c.setLineDash([5 * hr, 4 * hr]);
          c.strokeStyle = `rgba(${BLUE}, 0.55)`;
          for (const x of t.closeTime == null ? [x0] : [x0, x1]) {
            c.beginPath();
            c.moveTo(x * hr, 0);
            c.lineTo(x * hr, bitmapSize.height);
            c.stroke();
          }
          c.setLineDash([]);
        });
      },
    };
  }
}
