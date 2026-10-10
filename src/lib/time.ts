import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const DEFAULT_TZ = "Asia/Hong_Kong";

/** Trading day (YYYY-MM-DD) of a UTC instant in the given display timezone. */
export function dayKey(d: Date, tz = DEFAULT_TZ): string {
  return format(new TZDate(d, tz), "yyyy-MM-dd");
}

/**
 * How a broker's MT4 server clock maps to UTC.
 *  - "NYCLOSE": GMT+2 in winter / GMT+3 in summer, switching with US daylight saving (most MT4 brokers)
 *  - "UTC+2", "UTC-5", "UTC+5.5": fixed offset, no daylight saving
 *  - any IANA zone, e.g. "Europe/Helsinki" (GMT+2/+3 switching with EU daylight saving)
 */
export const BROKER_TIME_PRESETS = [
  { value: "NYCLOSE", label: "GMT+2 / GMT+3 (US daylight saving), most brokers" },
  { value: "Europe/Helsinki", label: "GMT+2 / GMT+3 (EU daylight saving)" },
  { value: "UTC+0", label: "Fixed GMT+0" },
  { value: "UTC+2", label: "Fixed GMT+2" },
  { value: "UTC+3", label: "Fixed GMT+3" },
] as const;

const FIXED = /^UTC([+-]\d+(?:\.\d+)?)$/;

/** Wall-clock components of a "naive" instant (MT4 stores server time as seconds-since-epoch of the wall clock). */
function wallParts(naive: Date) {
  return [naive.getUTCFullYear(), naive.getUTCMonth(), naive.getUTCDate(), naive.getUTCHours(), naive.getUTCMinutes(), naive.getUTCSeconds()] as const;
}

/** MT4 server timestamp (seconds, server wall-clock) → real UTC instant. */
export function brokerEpochToUtc(serverEpochSec: number, mode = "NYCLOSE"): Date {
  const naive = new Date(serverEpochSec * 1000);
  const fixed = mode.match(FIXED);
  if (fixed) return new Date(naive.getTime() - Number(fixed[1]) * 3_600_000);
  if (mode === "NYCLOSE") {
    // server time = New York time + 7h
    const [y, mo, d, h, mi, s] = wallParts(new Date(naive.getTime() - 7 * 3_600_000));
    return new Date(new TZDate(y, mo, d, h, mi, s, "America/New_York").getTime());
  }
  const [y, mo, d, h, mi, s] = wallParts(naive);
  return new Date(new TZDate(y, mo, d, h, mi, s, mode).getTime());
}

/** The server's offset from UTC (minutes) at a given real instant under `mode`. */
export function brokerOffsetMinutesAt(utc: Date, mode = "NYCLOSE"): number {
  const fixed = mode.match(FIXED);
  if (fixed) return Math.round(Number(fixed[1]) * 60);
  const zone = mode === "NYCLOSE" ? "America/New_York" : mode;
  const base = mode === "NYCLOSE" ? 7 * 60 : 0;
  return Math.round(new TZDate(utc, zone).getTimezoneOffset() * -1) + base;
}

export const isValidBrokerTimeMode = (mode: string) => {
  if (mode === "NYCLOSE" || FIXED.test(mode)) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: mode });
    return true;
  } catch {
    return false;
  }
};

export const fmtDateTime = (d: Date, tz = DEFAULT_TZ) => format(new TZDate(d, tz), "dd MMM yyyy, HH:mm");
export const fmtTime = (d: Date, tz = DEFAULT_TZ) => format(new TZDate(d, tz), "HH:mm");

/** Interpret a "YYYY-MM-DDTHH:mm" form value as wall-clock time in `tz` and return the UTC instant (NaN date if invalid). */
export function localToUtc(value: string, tz = DEFAULT_TZ): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return new Date(NaN);
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const sec = m[6] ? Number(m[6]) : 0;
  return new Date(new TZDate(y, mo - 1, d, h, mi, sec, tz).getTime());
}

/** Compact "09 Oct, 21:45" for tight lists. */
export const fmtShortDateTime = (d: Date, tz = DEFAULT_TZ) => format(new TZDate(d, tz), "dd MMM, HH:mm");

/** Offset of `tz` from UTC, in minutes, at a given instant (daylight saving aware). */
export const offsetMinutesAt = (d: Date, tz = DEFAULT_TZ) => -new TZDate(d, tz).getTimezoneOffset();
