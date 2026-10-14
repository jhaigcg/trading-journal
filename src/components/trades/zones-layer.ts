import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { Zone } from "@/lib/smc";

// FVGs are green / red like the candles; order blocks are blue (demand) and amber (supply) so the two read apart at a glance
const RGB = { FVG: { bull: "61, 211, 154", bear: "242, 107, 111" }, OB: { bull: "127, 183, 240", bear: "224, 176, 78" } } as const;

/** Fair value gaps and order blocks as shaded boxes: from where they formed to where price used them up, or the right edge while still open. */
export class ZonesLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<"Candlestick", Time> | null = null;
  private request: (() => void) | null = null;
  private zones: Zone[] = [];

  /** `shift` is added to every time so the zones line up with a chart drawn in the display timezone */
  constructor(private shift = 0) {}

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<"Candlestick", Time>;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = this.series = this.request = null;
  }
  set(zones: Zone[]) {
    this.zones = zones;
    this.request?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "bottom", renderer: () => this.renderer() }];
  }

  private renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        const { chart, series } = this;
        if (!chart || !series || this.zones.length === 0) return;
        target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
          const ts = chart.timeScale();
          for (const z of this.zones) {
            const y0 = series.priceToCoordinate(z.top);
            const y1 = series.priceToCoordinate(z.bottom);
            const xs = ts.timeToCoordinate((z.startT + this.shift) as Time);
            if (y0 == null || y1 == null || xs == null) continue;
            const xe = z.endT == null ? null : ts.timeToCoordinate((z.endT + this.shift) as Time);
            const left = Math.max(0, xs * hr);
            const right = xe == null ? bitmapSize.width : Math.min(bitmapSize.width, xe * hr);
            if (right <= left) continue;
            const top = Math.min(y0, y1) * vr;
            const h = Math.max(1, Math.abs(y1 - y0) * vr);
            const rgb = RGB[z.kind][z.side];
            const open = z.endT == null;
            c.fillStyle = `rgba(${rgb}, ${z.kind === "OB" ? (open ? 0.2 : 0.1) : open ? 0.16 : 0.08})`;
            c.fillRect(left, top, right - left, h);
            if (z.kind === "OB") {
              c.strokeStyle = `rgba(${rgb}, ${open ? 0.7 : 0.35})`;
              c.lineWidth = Math.max(1, hr);
              c.strokeRect(left, top, right - left, h);
            }
            if (right - left > 28 * hr && h > 11 * vr) {
              c.font = `${10 * hr}px system-ui, sans-serif`;
              c.fillStyle = `rgba(${rgb}, 0.95)`;
              c.textBaseline = "top";
              c.fillText(z.kind, left + 4 * hr, top + 2 * vr);
            }
          }
        });
      },
    };
  }
}
