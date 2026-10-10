import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-card p-6">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D1015" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17l5-5 4 4 7-8" />
            </svg>
          </div>
          <div className="text-base font-bold">
            Ledger<span className="text-accent">.</span>
          </div>
        </div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Your private trading journal.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
