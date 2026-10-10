"use client";

import { Check, Copy, Download } from "lucide-react";
import { useActionState, useState } from "react";
import { ServerCombobox } from "@/components/accounts/server-combobox";
import { createEaAccount, regenerateEaToken, type EaState } from "./actions";

const input =
  "min-h-11 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const label = "flex flex-col gap-1.5 text-xs text-muted";

function CopyField({ value, secret }: { value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={`${input} num text-xs ${secret ? "text-accent" : ""}`} aria-label={secret ? "Token" : "Endpoint"} />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Shown once after a token is created or regenerated, with the install steps. */
export function TokenPanel({ token, endpoint }: { token: string; endpoint: string }) {
  const origin = endpoint.replace(/\/api\/ingest\/mt4$/, "");
  return (
    <div className="rounded-control border border-line-strong bg-inset p-4 text-sm">
      <p className="font-semibold text-accent">Copy your token now. It is shown only once.</p>
      <div className="mt-3 flex flex-col gap-3">
        <div className={label}>
          Token
          <CopyField value={token} secret />
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-ink-2">
          <li>
            <a href="/api/ea/download" className="inline-flex items-center gap-1.5 text-accent underline">
              <Download size={14} /> Download LedgerSync.mq4
            </a>{" "}
            (your address is already filled in). In MT4 choose <b>File → Open Data Folder</b>, put the file in <code className="num text-xs">MQL4\Experts</code>, then restart MT4 (or right-click Navigator → Refresh).
          </li>
          <li>
            <b>Tools → Options → Expert Advisors</b>: tick <b>Allow WebRequest for listed URL</b> and add:
            <div className="mt-1.5">
              <CopyField value={origin} />
            </div>
          </li>
          <li>
            In the <b>Terminal</b> window open the <b>Account History</b> tab, right-click and choose <b>All History</b>, so MT4 loads every past trade.
          </li>
          <li>
            Drag <b>LedgerSync</b> from Navigator onto any chart, paste the token into the <b>Token</b> input, and make sure <b>AutoTrading</b> is on. The chart corner will show &ldquo;connected&rdquo;.
          </li>
        </ol>
        <p className="text-xs text-muted">The first run uploads your whole history (a few minutes for thousands of trades). After that new trades arrive within seconds, and MT4 only needs to be open from time to time: the EA catches up on anything it missed.</p>
      </div>
    </div>
  );
}

export function ConnectEaForm({ knownServers = [] }: { knownServers?: string[] }) {
  const [state, action, pending] = useActionState<EaState, FormData>(createEaAccount, undefined);

  if (state?.token && state.endpoint) return <TokenPanel token={state.token} endpoint={state.endpoint} />;

  return (
    <form action={action} autoComplete="off" className="grid max-w-[640px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
      <label className={label}>
        MT4 login (account number)
        <input name="login" required inputMode="numeric" pattern="[0-9]{3,12}" placeholder="12345678" className={input} />
      </label>
      <label className={label}>
        Broker server
        <ServerCombobox mine={knownServers} />
        <span className="text-[11px]">Not listed? Type it exactly as MT4 shows it (File → Login to Trade Account).</span>
      </label>
      <div className="col-span-full flex flex-col gap-3">
        {state?.error && (
          <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
            {state.error}
          </p>
        )}
        <button disabled={pending} className="min-h-11 self-start rounded-control bg-accent px-5 text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60">
          {pending ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  );
}

export function RegenerateToken({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState<EaState, FormData>(regenerateEaToken, undefined);
  return (
    <div>
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm("Create a new token? The EA on your MT4 will stop sending until you paste the new one into its Token input.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="accountId" value={accountId} />
        <button disabled={pending} className="inline-flex min-h-9 items-center rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active disabled:opacity-60">
          {pending ? "…" : "New token"}
        </button>
      </form>
      {state?.error && <p className="mt-1 text-xs text-loss">{state.error}</p>}
      {state?.token && state.endpoint && (
        <div className="mt-3 w-[min(560px,80vw)]">
          <TokenPanel token={state.token} endpoint={state.endpoint} />
        </div>
      )}
    </div>
  );
}
