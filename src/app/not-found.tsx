import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-card p-8 text-center">
        <div className="num text-4xl font-semibold text-accent">404</div>
        <h1 className="mt-2 text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">That page does not exist, or the trade or note was deleted.</p>
        <Link href="/dashboard" className="mt-5 inline-flex min-h-10 items-center rounded-control bg-accent px-5 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
