import { cn } from "@/lib/cn";

const VARIANTS = {
  primary: "bg-accent text-bg font-semibold hover:bg-[var(--accent-hover)]",
  light: "bg-ink text-bg font-semibold hover:bg-white",
  outline: "border border-line-strong bg-card text-ink hover:bg-nav-active",
  ghost: "text-muted hover:bg-nav-active hover:text-ink",
} as const;

export function Button({
  variant = "outline",
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-control px-3.5 text-[13px] disabled:opacity-60",
        VARIANTS[variant],
        className,
      )}
      {...p}
    />
  );
}
