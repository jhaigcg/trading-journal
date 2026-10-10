import { TZDate } from "@date-fns/tz";
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth, startOfWeek, startOfYear, subDays } from "date-fns";
import { DEFAULT_TZ } from "@/lib/time";

export const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "30d", label: "Last 30 days" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["value"];

export interface DateRange {
  /** inclusive trading-day bounds, YYYY-MM-DD in the display timezone; null = unbounded */
  from: string | null;
  to: string | null;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

export function resolveRange(
  key: string | undefined,
  custom: { from?: string; to?: string } = {},
  now: Date = new Date(),
  tz = DEFAULT_TZ,
): DateRange {
  const n = new TZDate(now, tz);
  switch (key) {
    case "today":
      return { from: ymd(startOfDay(n)), to: ymd(endOfDay(n)) };
    case "week":
      return { from: ymd(startOfWeek(n, { weekStartsOn: 1 })), to: ymd(n) };
    case "30d":
      return { from: ymd(subDays(n, 29)), to: ymd(n) };
    case "ytd":
      return { from: ymd(startOfYear(n)), to: ymd(n) };
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: custom.from ?? null, to: custom.to ?? null };
    case "month":
    default:
      return { from: ymd(startOfMonth(n)), to: ymd(endOfMonth(n)) };
  }
}
