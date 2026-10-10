export type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4" | "D1";
export type NativeTimeframe = "M1" | "H1";

export const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "H1", "H4", "D1"];
export const TF_LABEL: Record<Timeframe, string> = { M1: "1m", M5: "5m", M15: "15m", H1: "1h", H4: "4h", D1: "1D" };
export const TF_SECONDS: Record<Timeframe, number> = { M1: 60, M5: 300, M15: 900, H1: 3600, H4: 14_400, D1: 86_400 };

/** Timeframes we download from the data source; everything else is aggregated from these. */
export const NATIVE: Record<Timeframe, NativeTimeframe> = { M1: "M1", M5: "M1", M15: "M1", H1: "H1", H4: "H1", D1: "H1" };

export const isTimeframe = (v: string): v is Timeframe => (TIMEFRAMES as string[]).includes(v);

/** One OHLC bar. `t` is the bar open time in UTC unix seconds. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** A source of historical candles. Swap implementations (Dukascopy, MetaApi, a paid feed) without touching callers. */
export interface MarketDataProvider {
  readonly id: string;
  supports(symbol: string): boolean;
  /** One whole native period: a UTC day (M1, "2026-09-07") or month (H1, "2026-09"). */
  fetchPeriod(symbol: string, native: NativeTimeframe, period: string): Promise<Candle[]>;
}
