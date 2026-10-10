"use client";

import { Plus, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { estimateGross } from "@/lib/import/manual";
import { cn } from "@/lib/cn";
import { createManualTrade } from "./actions";

interface Row {
  kind: "ENTRY" | "EXIT";
  at: string;
  price: string;
  lots: string;
  fee: string;
}

const input = "min-h-11 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const label = "flex flex-col gap-1.5 text-xs text-muted";

const nowLocal = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ManualTradeForm({
  accounts,
  strategies,
  symbols,
}: {
  accounts: { id: string; name: string; currency: string }[];
  strategies: { id: string; name: string }[];
  symbols: { symbol: string; contractSize: number }[];
}) {
  const [state, action, pending] = useActionState(createManualTrade, undefined);
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [symbol, setSymbol] = useState("XAUUSD");
  const [gross, setGross] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [
    { kind: "ENTRY", at: "", price: "", lots: "", fee: "" },
    { kind: "EXIT", at: "", price: "", lots: "", fee: "" },
  ]);
  // datetime-local defaults are filled on the client to avoid server/client clock mismatch
  const [defaultsSet, setDefaultsSet] = useState(false);
  if (!defaultsSet) {
    setDefaultsSet(true);
    setRows((r) => r.map((x) => ({ ...x, at: x.at || nowLocal() })));
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const contractSize = useMemo(() => symbols.find((s) => s.symbol === symbol.trim().toUpperCase())?.contractSize ?? 100_000, [symbols, symbol]);

  const autoCalc = () => {
    const fills = (kind: Row["kind"]) => rows.filter((r) => r.kind === kind).map((r) => ({ lots: Number(r.lots), price: Number(r.price) })).filter((r) => r.lots > 0 && r.price > 0);
    const g = estimateGross(side, fills("ENTRY"), fills("EXIT"), contractSize);
    if (g != null) setGross(String(g));
  };

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="executions" value={JSON.stringify(rows)} />
      <input type="hidden" name="side" value={side} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <label className={label}>
          Account
          <select name="accountId" required className={input}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Symbol
          <input name="symbol" list="symbols" required value={symbol} onChange={(e) => setSymbol(e.target.value)} className={input} />
          <datalist id="symbols">
            {symbols.map((s) => (
              <option key={s.symbol} value={s.symbol} />
            ))}
          </datalist>
        </label>
        <div className={label}>
          Side
          <div className="flex gap-1.5" role="group" aria-label="Side">
            {(["LONG", "SHORT"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={side === s}
                onClick={() => setSide(s)}
                className={cn("min-h-11 flex-1 rounded-control border text-sm font-semibold", side === s ? (s === "LONG" ? "border-long bg-long-bg text-long" : "border-loss bg-loss-bg text-loss") : "border-line-strong text-muted")}
              >
                {s === "LONG" ? "Long" : "Short"}
              </button>
            ))}
          </div>
        </div>
        <label className={label}>
          Strategy (optional)
          <select name="strategyId" className={input} defaultValue="">
            <option value="">None</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Fills</div>
        <p className="mb-2 text-xs text-muted">Times are in your display timezone. Add several exits to record a partial close or scale-out.</p>
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[110px_minmax(170px,1.4fr)_1fr_1fr_1fr_44px] items-end gap-2 max-md:grid-cols-2">
              <label className={label}>
                {i === 0 && "Type"}
                <select value={r.kind} onChange={(e) => update(i, { kind: e.target.value as Row["kind"] })} className={input} aria-label="Fill type">
                  <option value="ENTRY">Entry</option>
                  <option value="EXIT">Exit</option>
                </select>
              </label>
              <label className={label}>
                {i === 0 && "Date & time"}
                <input type="datetime-local" required value={r.at} onChange={(e) => update(i, { at: e.target.value })} className={input} aria-label="Date and time" />
              </label>
              <label className={label}>
                {i === 0 && "Price"}
                <input type="number" step="any" min="0" required value={r.price} onChange={(e) => update(i, { price: e.target.value })} className={cn(input, "num")} aria-label="Price" />
              </label>
              <label className={label}>
                {i === 0 && "Lots"}
                <input type="number" step="any" min="0" required value={r.lots} onChange={(e) => update(i, { lots: e.target.value })} className={cn(input, "num")} aria-label="Lots" />
              </label>
              <label className={label}>
                {i === 0 && "Fee"}
                <input type="number" step="any" min="0" value={r.fee} onChange={(e) => update(i, { fee: e.target.value })} placeholder="0" className={cn(input, "num")} aria-label="Fee" />
              </label>
              <button
                type="button"
                disabled={rows.length <= 1}
                onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                aria-label="Remove fill"
                className="flex min-h-11 items-center justify-center rounded-control text-muted hover:bg-nav-active hover:text-loss disabled:opacity-30"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { kind: "EXIT", at: nowLocal(), price: "", lots: "", fee: "" }])}
          className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active"
        >
          <Plus size={14} /> Add fill
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <label className={label}>
          Gross P&amp;L (account currency)
          <div className="flex gap-2">
            <input name="grossPnl" type="number" step="any" required value={gross} onChange={(e) => setGross(e.target.value)} className={cn(input, "num")} />
            <button type="button" onClick={autoCalc} className="min-h-11 shrink-0 rounded-control border border-line-strong px-3 text-xs hover:bg-nav-active" title="Estimate from prices × lots × contract size. Assumes the quote currency equals your account currency.">
              Estimate
            </button>
          </div>
        </label>
        <label className={label}>
          Swap
          <input name="swap" type="number" step="any" placeholder="0 (negative = cost)" className={cn(input, "num")} />
        </label>
        <label className={label}>
          Stop loss
          <input name="stopLoss" type="number" step="any" min="0" className={cn(input, "num")} />
        </label>
        <label className={label}>
          Take profit
          <input name="takeProfit" type="number" step="any" min="0" className={cn(input, "num")} />
        </label>
      </div>

      <label className={label}>
        Comment (optional)
        <input name="comment" maxLength={500} className={input} />
      </label>

      {state?.error && (
        <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="min-h-11 self-start rounded-control bg-accent px-5 text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60">
        {pending ? "Saving…" : "Save trade"}
      </button>
    </form>
  );
}
