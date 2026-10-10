import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { ManualTradeForm } from "./trade-form";

export const metadata: Metadata = { title: "Add a trade" };

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const [accounts, strategies, symbols] = await Promise.all([
    db.account.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }),
    db.strategy.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.symbolConfig.findMany({ select: { symbol: true, contractSize: true } }),
  ]);

  return (
    <>
      <PageHeader eyebrow="Trades" title="Add trade">
        <Link href="/accounts" className="text-sm text-muted hover:text-ink">
          ← Accounts &amp; import
        </Link>
      </PageHeader>
      {saved && (
        <p role="status" className="mb-4 rounded-control border border-[var(--profit-border)] bg-profit-bg px-4 py-3 text-sm text-profit">
          Trade saved. It is included in your dashboard and calendar.
        </p>
      )}
      <Card>
        <ManualTradeForm accounts={accounts} strategies={strategies} symbols={symbols.map((s) => ({ symbol: s.symbol, contractSize: Number(s.contractSize) }))} />
      </Card>
    </>
  );
}
