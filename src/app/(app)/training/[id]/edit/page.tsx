import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ScenarioForm } from "@/components/training/scenario-form";
import { db } from "@/lib/db";
import { settingsFor } from "@/lib/queries/trade-list";
import { loadForEdit } from "@/lib/training/scenarios";
import { offsetMinutesAt } from "@/lib/time";

export const metadata: Metadata = { title: "Edit training scenario" };

export default async function EditScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s, { tz }] = await Promise.all([loadForEdit(id), settingsFor()]);
  if (!s) notFound();
  const strategies = await db.strategy.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <Link href={`/training/${id}`} className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Back to the scenario
      </Link>
      <PageHeader title="Edit scenario" eyebrow="Training" />
      <ScenarioForm initial={s} strategies={strategies} tz={tz} tzOffsetMin={offsetMinutesAt(new Date(s.decisionAt), tz)} />
    </>
  );
}
