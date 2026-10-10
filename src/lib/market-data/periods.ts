import type { NativeTimeframe } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** The download periods (UTC) that cover [fromSec, toSec]: days for M1, months for H1. */
export function periodsFor(native: NativeTimeframe, fromSec: number, toSec: number): string[] {
  const out: string[] = [];
  const a = new Date(fromSec * 1000);
  const b = new Date(toSec * 1000);
  if (native === "M1") {
    for (let d = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()); d <= toSec * 1000; d += 86_400_000) {
      const x = new Date(d);
      out.push(`${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`);
    }
  } else {
    let y = a.getUTCFullYear();
    let m = a.getUTCMonth();
    while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
      out.push(`${y}-${pad(m + 1)}`);
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  }
  return out;
}

/** [start, end) of a period in unix seconds. */
export function periodRange(native: NativeTimeframe, period: string): [number, number] {
  const [y, m, d] = period.split("-").map(Number);
  if (native === "M1") return [Date.UTC(y, m - 1, d) / 1000, Date.UTC(y, m - 1, d + 1) / 1000];
  return [Date.UTC(y, m - 1, 1) / 1000, Date.UTC(y, m, 1) / 1000];
}
