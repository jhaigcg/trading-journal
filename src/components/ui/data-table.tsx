import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

/** Presentational table. Wide tables scroll horizontally inside their card; sorting and pagination are driven by the parent through URL params. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty = "No data",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c.key} className={cn("whitespace-nowrap px-3 py-2.5 font-medium", c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-[var(--row-line)] hover:bg-nav-active/50">
              {columns.map((c, i) => (
                <td key={c.key} className={cn("whitespace-nowrap px-3 py-2.5", c.align === "right" && "text-right", c.className)}>
                  {rowHref && i === 0 ? <a href={rowHref(r)}>{c.cell(r)}</a> : c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
