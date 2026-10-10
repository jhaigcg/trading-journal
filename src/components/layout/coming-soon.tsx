import { PageHeader } from "./page-header";
import { Card } from "@/components/ui/card";

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card className="py-16 text-center text-muted">Planned for {phase}.</Card>
    </>
  );
}
