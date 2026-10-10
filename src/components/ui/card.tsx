import { cn } from "@/lib/cn";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-card border border-line bg-card p-4", className)} {...p} />;
}

export function CardHeader({ title, right, className }: { title: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {right && <div className="text-xs text-muted">{right}</div>}
    </div>
  );
}
