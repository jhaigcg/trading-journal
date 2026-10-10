"use client";

import { useActionState, useEffect, useRef } from "react";
import { useSync } from "@/components/sync/use-sync";
import { connectAccount } from "./actions";

const input =
  "min-h-11 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const label = "flex flex-col gap-1.5 text-xs text-muted";

export function ConnectForm({ configured, defaultFrom }: { configured: boolean; defaultFrom: string }) {
  const [state, action, pending] = useActionState(connectAccount, undefined);
  const { state: sync, start } = useSync();
  const started = useRef<string | null>(null);

  // as soon as the account exists, kick off the first (backfill) sync
  useEffect(() => {
    if (state?.accountId && started.current !== state.accountId) {
      started.current = state.accountId;
      void start([state.accountId]);
    }
  }, [state?.accountId, start]);

  return (
    <form action={action} autoComplete="off" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      <label className={label}>
        Account name
        <input name="name" required placeholder="MT4 · Main account" className={input} />
      </label>
      <label className={label}>
        MT4 login (account number)
        <input name="login" required inputMode="numeric" pattern="\d{3,12}" placeholder="12345678" className={input} />
      </label>
      <label className={label}>
        Investor password (read-only)
        <input name="investorPassword" type="password" required autoComplete="new-password" className={input} />
      </label>
      <label className={label}>
        Broker server
        <input name="server" required placeholder="ICMarketsSC-Live01" className={input} />
      </label>
      <label className={label}>
        Broker name (optional)
        <input name="broker" placeholder="IC Markets" className={input} />
      </label>
      <label className={label}>
        Import history from
        <input name="backfillFrom" type="date" required defaultValue={defaultFrom} className={input} />
      </label>
      <label className={label}>
        Balance before that date (AUD)
        <input name="startingBalance" type="number" step="0.01" min="0" required defaultValue="0" className={input} />
        <span className="text-[11px]">Use 0 if the imported history includes your first deposit.</span>
      </label>

      <div className="col-span-full flex flex-col gap-3">
        <p className="text-xs text-muted">
          Use the <strong className="text-ink-2">investor</strong> password, which can view but never trade. It is sent once to MetaApi to link the account and is not stored by this app.
        </p>
        {!configured && (
          <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
            MetaApi is not configured yet. Add METAAPI_TOKEN to your environment, then restart.
          </p>
        )}
        {state?.error && (
          <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
            {state.error}
          </p>
        )}
        {state?.accountId && (
          <div role="status" className="rounded-control border border-line-strong bg-inset px-3 py-2 text-sm text-ink-2">
            {sync.error ? (
              <span className="text-loss">Connected, but the first sync failed: {sync.error}. Use Resync once the login details are fixed.</span>
            ) : sync.done ? (
              "Connected and synced."
            ) : (
              <>
                {sync.message ?? "Connected. Importing your history…"} <span className="num text-muted">{Math.round(sync.progress * 100)}%</span>
              </>
            )}
          </div>
        )}
        <button
          disabled={pending || !configured}
          className="min-h-11 self-start rounded-control bg-accent px-5 text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {pending ? "Connecting…" : "Connect MT4 account"}
        </button>
      </div>
    </form>
  );
}
