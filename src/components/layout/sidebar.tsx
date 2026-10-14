"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

const NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Trades", href: "/trades" },
  { label: "Notebook", href: "/notebook" },
  { label: "Reports", href: "/reports" },
  { label: "Playbooks", href: "/playbooks" },
  { label: "Replay", href: "/replay" },
  { label: "Training", href: "/training" },
  { label: "Progress", href: "/progress" },
  { label: "Accounts & import", href: "/accounts" },
  { label: "Settings", href: "/settings" },
];

export function Sidebar({ logout }: { logout: () => Promise<void> }) {
  const path = usePathname();
  const strip = useRef<HTMLDivElement>(null);

  // on a phone the menu scrolls sideways: keep the page you are on in view
  useEffect(() => {
    const active = strip.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [path]);

  return (
    <nav
      aria-label="Main"
      className="flex w-full shrink-0 flex-col gap-1 border-b border-line bg-sidebar px-3.5 py-2.5 md:sticky md:top-0 md:h-screen md:w-[220px] md:border-b-0 md:border-r md:py-5"
    >
      {/* phones: the logo and the add button share one row; desktop stacks them */}
      <div className="flex items-center justify-between gap-2 md:block">
        <div className="flex items-center gap-2.5 px-1 md:px-2 md:pb-5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D1015" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17l5-5 4 4 7-8" />
            </svg>
          </div>
          <div className="text-base font-bold tracking-[0.2px]">
            Ledger<span className="text-accent">.</span>
          </div>
        </div>
        <Link
          href="/accounts"
          className="flex min-h-10 items-center justify-center rounded-control bg-accent px-4 text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] md:mb-3.5 md:min-h-11 md:w-full md:px-0"
        >
          <span className="md:hidden">+ Add</span>
          <span className="hidden md:inline">+ Add / import trades</span>
        </Link>
      </div>
      {/* horizontally scrollable strip on phones (scrollbar hidden), vertical list on desktop */}
      <div ref={strip} className="flex gap-1 overflow-x-auto [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-visible [&::-webkit-scrollbar]:hidden">
        {NAV.map((n) => {
          const on = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-sm",
                on ? "bg-nav-active font-semibold text-ink" : "text-muted hover:text-ink",
              )}
            >
              {n.label}
            </Link>
          );
        })}
        {/* on a phone Sign out sits at the end of the strip */}
        <form action={logout} className="shrink-0 md:hidden">
          <button className="flex min-h-10 items-center whitespace-nowrap rounded-lg px-3 text-sm text-muted hover:text-ink">Sign out</button>
        </form>
      </div>
      <form action={logout} className="hidden md:block">
        <button className="min-h-10 w-full rounded-lg px-3 text-left text-sm text-muted hover:text-ink">Sign out</button>
      </form>
    </nav>
  );
}
