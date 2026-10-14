import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EventPlayer } from "@/components/training/event-player";
import { SetupPlayer } from "@/components/training/setup-player";
import { db } from "@/lib/db";
import { settingsFor } from "@/lib/queries/trade-list";
import { offsetMinutesAt } from "@/lib/time";

export const metadata: Metadata = { title: "Training" };

export default async function TrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await db.trainingScenario.findUnique({ where: { id }, select: { id: true, title: true, kind: true, decisionAt: true, archived: true } });
  if (!s || s.archived) notFound();
  const { tz } = await settingsFor();
  const all = await db.trainingScenario.findMany({ where: { archived: false }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const at = all.findIndex((x) => x.id === id);
  const next = all.length > 1 ? all[(at + 1) % all.length].id : null;
  const nextHref = next ? `/training/${next}` : null;
  const off = offsetMinutesAt(s.decisionAt, tz);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/training" className="text-sm text-muted hover:text-ink">
          ← Training
        </Link>
        <Link href={`/training/${id}/edit`} className="text-sm text-muted hover:text-ink">
          Edit scenario
        </Link>
      </div>
      <PageHeader title={s.kind === "EVENT" ? "News event" : "Mark the setup"} eyebrow="Training" />
      {s.kind === "EVENT" ? <EventPlayer key={id} id={id} tzOffsetMin={off} nextHref={nextHref} /> : <SetupPlayer key={id} id={id} tzOffsetMin={off} nextHref={nextHref} />}
    </>
  );
}
