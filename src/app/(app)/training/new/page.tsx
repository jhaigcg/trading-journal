import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ScenarioForm } from "@/components/training/scenario-form";
import { db } from "@/lib/db";
import { parsePrefill } from "@/lib/training/prefill";
import { settingsFor } from "@/lib/queries/trade-list";
import { offsetMinutesAt } from "@/lib/time";

export const metadata: Metadata = { title: "New training scenario" };

export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const prefill = parsePrefill(params);
  const startKind = prefill.kind ?? "SETUP";
  const { tz } = await settingsFor();
  const strategies = await db.strategy.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <Link href="/training" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Training
      </Link>
      <PageHeader title="New scenario" eyebrow="Training" />
      {Object.keys(prefill).length > 0 && <p className="mb-3 rounded-control border border-line bg-card px-3 py-2 text-xs text-muted">Filled in from a link. Nothing is saved yet: check the values, then save.</p>}
      <ScenarioForm initial={null} startKind={startKind} prefill={prefill} strategies={strategies} tz={tz} tzOffsetMin={offsetMinutesAt(new Date(), tz)} />
    </>
  );
}
