"use client";

import { useActionState } from "react";
import { BROKER_TIME_PRESETS } from "@/lib/time";
import { updateBrokerTime, type TimeModeState } from "./actions";

/** Change how the MT4 server clock maps to UTC; every stored trade time is re-converted. */
export function BrokerTimeForm({ accountId, mode }: { accountId: string; mode: string }) {
  const [state, action, pending] = useActionState<TimeModeState, FormData>(updateBrokerTime, undefined);
  const known = BROKER_TIME_PRESETS.some((p) => p.value === mode);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Change the broker time setting? All trade times will be re-converted (this can take a minute for thousands of trades).")) e.preventDefault();
      }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex items-center gap-2">
        <select name="brokerTimeMode" defaultValue={mode} aria-label="Broker server time" className="min-h-9 max-w-[260px] rounded-control border border-line-strong bg-inset px-2 text-xs">
          {!known && <option value={mode}>{mode}</option>}
          {BROKER_TIME_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <button disabled={pending} className="min-h-9 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active disabled:opacity-60">
          {pending ? "Converting…" : "Apply"}
        </button>
      </div>
      {state?.error && <span className="text-xs text-loss">{state.error}</span>}
      {state?.ok && <span className="text-xs text-profit">{state.ok}</span>}
    </form>
  );
}
