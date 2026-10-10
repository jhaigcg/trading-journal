"use client";

import { useActionState } from "react";
import { login } from "./actions";

const input =
  "min-h-11 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-5 flex flex-col gap-3">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Email
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {state?.error && (
        <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="mt-1 min-h-11 rounded-control bg-accent text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
