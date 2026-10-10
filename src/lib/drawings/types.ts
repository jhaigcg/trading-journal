/** Things drawn on a trade's chart. Stored in market coordinates (UTC time, price) so they stay put on every timeframe. */
export const DRAWING_KINDS = ["trend", "hline", "rect", "note"] as const;
export type DrawingKind = (typeof DRAWING_KINDS)[number];

export const DRAWING_COLORS = ["#E0B04E", "#3DD39A", "#F26B6F", "#7FB7F0", "#C084FC", "#E6EAF0"] as const;
export const DRAWING_COLOR_NAMES = ["Gold", "Green", "Red", "Blue", "Purple", "White"] as const;

export interface DrawingPoint {
  /** unix seconds, UTC */
  t: number;
  p: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  color: string;
  points: DrawingPoint[];
  /** note text */
  text?: string;
}

/** How many clicks each tool needs. */
export const POINTS_NEEDED: Record<DrawingKind, number> = { trend: 2, rect: 2, hline: 1, note: 1 };
export const MAX_DRAWINGS = 80;
