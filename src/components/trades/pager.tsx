import Link from "next/link";
import { cn } from "@/lib/cn";

/** Page navigation and page-size choice. Links only, so it works with server rendering and keeps every filter in the URL. */
export function Pager({
  page,
  total,
  size,
  sizes,
  hrefFor,
  unit = "trades",
}: {
  page: number;
  total: number;
  size: number;
  sizes?: readonly number[];
  hrefFor: (page: number, size: number) => string;
  unit?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const btn = "inline-flex min-h-9 items-center rounded-control border border-line-strong px-3 text-xs";
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
      <span className="num">
        {from}–{to} of {total.toLocaleString()} {unit}
      </span>
      <div className="flex items-center gap-2">
        {sizes && (
          <span className="mr-2 flex items-center gap-1">
            Per page
            {sizes.map((s) => (
              <Link key={s} href={hrefFor(1, s)} className={cn("rounded-md px-2 py-1", s === size ? "bg-line text-ink" : "hover:text-ink")}>
                {s}
              </Link>
            ))}
          </span>
        )}
        {page > 1 ? (
          <Link href={hrefFor(page - 1, size)} className={cn(btn, "text-ink hover:bg-nav-active")} rel="prev">
            ← Previous
          </Link>
        ) : (
          <span className={cn(btn, "opacity-40")}>← Previous</span>
        )}
        <span className="num">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1, size)} className={cn(btn, "text-ink hover:bg-nav-active")} rel="next">
            Next →
          </Link>
        ) : (
          <span className={cn(btn, "opacity-40")}>Next →</span>
        )}
      </div>
    </div>
  );
}
