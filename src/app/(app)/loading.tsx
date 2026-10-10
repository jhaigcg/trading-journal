/** Shown while a page's data loads: a quiet skeleton in the shape of a typical page, so the layout does not jump. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="mb-5 h-12 w-48 rounded-control bg-card" />
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-card border border-line bg-card" />
        ))}
      </div>
      <div className="h-72 rounded-card border border-line bg-card" />
    </div>
  );
}
