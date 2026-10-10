export function PageHeader({ eyebrow = "Journal", title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-xs uppercase tracking-[0.6px] text-muted">{eyebrow}</div>
        <h1 className="mt-0.5 text-[26px] font-semibold">{title}</h1>
      </div>
      {children}
    </header>
  );
}
