import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ScenarioForm } from "@/components/training/scenario-form";
import { db } from "@/lib/db";
import { settingsFor } from "@/lib/queries/trade-list";
import { offsetMinutesAt } from "@/lib/time";

export const metadata: Metadata = { title: "New training scenario" };

export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const startKind = (await searchParams).kind === "EVENT" ? "EVENT" : "SETUP";
  const { tz } = await settingsFor();
  const strategies = await db.strategy.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <Link href="/training" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Training
      </Link>
      <PageHeader title="New scenario" eyebrow="Training" />
      <ScenarioForm initial={null} startKind={startKind} strategies={strategies} tz={tz} tzOffsetMin={offsetMinutesAt(new Date(), tz)} />
    </>
  );
}
