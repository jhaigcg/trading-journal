import type { DrawingKind } from "./types";

export interface XY {
  x: number;
  y: number;
}

/** Distance from a point to a line segment, in the same units as the inputs. */
export function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Did a click at `p` land on a drawing whose screen points are `pts`? `tol` is the grab distance in pixels.
 * Lines count when close to the line, boxes when close to their outline or anywhere inside, notes near their anchor.
 */
export function hits(kind: DrawingKind, pts: XY[], p: XY, tol = 6): boolean {
  switch (kind) {
    case "trend":
      return pts.length === 2 && distToSegment(p, pts[0], pts[1]) <= tol;
    case "hline":
      return pts.length === 1 && Math.abs(p.y - pts[0].y) <= tol;
    case "rect": {
      if (pts.length !== 2) return false;
      const x0 = Math.min(pts[0].x, pts[1].x) - tol;
      const x1 = Math.max(pts[0].x, pts[1].x) + tol;
      const y0 = Math.min(pts[0].y, pts[1].y) - tol;
      const y1 = Math.max(pts[0].y, pts[1].y) + tol;
      return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    }
    case "note":
      return pts.length === 1 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol * 2;
  }
}

/** The measurement shown by the ruler between two chart points. */
export function measure(a: { t: number; p: number }, b: { t: number; p: number }, stepSec: number) {
  const diff = b.p - a.p;
  return { diff, pct: a.p === 0 ? 0 : (diff / a.p) * 100, bars: Math.round((b.t - a.t) / stepSec), seconds: b.t - a.t };
}
