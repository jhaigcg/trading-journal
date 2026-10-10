import type { Candle } from "./types";

/** Combine finer candles into bars of `tfSeconds` (buckets aligned to the UTC epoch). Input must be sorted by time. */
export function aggregate(candles: Candle[], tfSeconds: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const k of candles) {
    const bucket = Math.floor(k.t / tfSeconds) * tfSeconds;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v };
    } else {
      cur.h = Math.max(cur.h, k.h);
      cur.l = Math.min(cur.l, k.l);
      cur.c = k.c;
      cur.v += k.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}
