"use client";

import { Star } from "lucide-react";

/** Five-star rating in half-star steps. Click the left half of a star for x.5; click the current value again to clear it. */
export function Stars({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const v = value ?? 0;
  return (
    <div className="inline-flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, v - (n - 1)));
        const pick = (half: boolean) => {
          const next = half ? n - 0.5 : n;
          onChange(next === value ? null : next);
        };
        return (
          <span key={n} className="relative inline-block h-6 w-6">
            <Star size={22} className="absolute inset-0 text-line-strong" aria-hidden />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star size={22} className="fill-accent text-accent" aria-hidden />
            </span>
            <button type="button" disabled={disabled} aria-label={`${n - 0.5} stars`} onClick={() => pick(true)} className="absolute inset-y-0 left-0 w-1/2" />
            <button type="button" disabled={disabled} aria-label={`${n} stars`} onClick={() => pick(false)} className="absolute inset-y-0 right-0 w-1/2" />
          </span>
        );
      })}
      <span className="num ml-2 w-8 text-xs text-muted">{value == null ? "" : value.toFixed(1)}</span>
    </div>
  );
}
