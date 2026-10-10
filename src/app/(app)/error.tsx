"use client";

import { useEffect } from "react";

/** A page failed to load. The rest of the app (sidebar, other pages) keeps working. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-card border border-line bg-card p-8 text-center">
      <h1 className="text-lg font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted">Something went wrong while getting your data. Your journal is safe. Try again, and if it keeps happening, check that the database is running.</p>
      {error.digest && <p className="num mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-5 min-h-10 rounded-control bg-accent px-5 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
        Try again
      </button>
    </div>
  );
}
