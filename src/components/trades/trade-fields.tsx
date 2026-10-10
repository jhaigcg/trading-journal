"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setReviewed, updateTradeFields } from "@/app/(app)/trades/actions";
import { money } from "@/lib/format";
import type { TradeDTO } from "@/lib/queries/trade-detail";
import { emitTradeChanged } from "./events";
import { Stars } from "./stars";

const input = "min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-60";

type Num = number | null;
const parse = (s: string): Num | undefined => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Editable fields: stop loss, profit target, rating, strategy. Each change is saved immediately and the risk
 * and R multiples are recalculated on the server, so what is shown is always what is stored.
 */
export function TradeFields({ t, strategies }: { t: TradeDTO; strategies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [risk, setRisk] = useState({ tradeRisk: t.tradeRisk, plannedR: t.plannedR, realizedR: t.realizedR });
  const [sl, setSl] = useState(t.stopLoss?.toString() ?? "");
  const [tp, setTp] = useState(t.profitTarget?.toString() ?? "");
  const [rating, setRating] = useState<Num>(t.rating);

  const save = (patch: Parameters<typeof updateTradeFields>[1], revert?: () => void) =>
    start(async () => {
      setError(null);
      const r = await updateTradeFields(t.id, patch);
      if (!r.ok) {
        setError(r.error);
        revert?.();
        return;
      }
      setRisk({ tradeRisk: r.tradeRisk, plannedR: r.plannedR, realizedR: r.realizedR });
      router.refresh();
      emitTradeChanged();
    });

  const commit = (key: "stopLoss" | "profitTarget", raw: string, current: Num, revert: () => void) => {
    const v = parse(raw);
    if (v === undefined) {
      setError("Enter a number.");
      return revert();
    }
    if (v === current) return;
    save({ [key]: v }, revert);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Stop loss
          <input
            className={`${input} num`}
            inputMode="decimal"
            value={sl}
            disabled={pending}
            placeholder="none"
            onChange={(e) => setSl(e.target.value)}
            onBlur={() => commit("stopLoss", sl, t.stopLoss, () => setSl(t.stopLoss?.toString() ?? ""))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Profit target
          <input
            className={`${input} num`}
            inputMode="decimal"
            value={tp}
            disabled={pending}
            placeholder="none"
            onChange={(e) => setTp(e.target.value)}
            onBlur={() => commit("profitTarget", tp, t.profitTarget, () => setTp(t.profitTarget?.toString() ?? ""))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-control border border-line bg-inset px-3 py-2.5 text-xs">
        <div>
          <div className="text-muted">Risk</div>
          <div className="num mt-0.5 text-sm">{risk.tradeRisk == null ? "—" : money(risk.tradeRisk, t.currency, { signed: false })}</div>
        </div>
        <div>
          <div className="text-muted">Planned R</div>
          <div className="num mt-0.5 text-sm">{risk.plannedR == null ? "—" : `${risk.plannedR.toFixed(2)}R`}</div>
        </div>
        <div>
          <div className="text-muted">Realized R</div>
          <div className={`num mt-0.5 text-sm ${risk.realizedR == null ? "" : risk.realizedR >= 0 ? "text-profit" : "text-loss"}`}>{risk.realizedR == null ? "—" : `${risk.realizedR > 0 ? "+" : ""}${risk.realizedR.toFixed(2)}R`}</div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-muted">
        Rating
        <Stars
          value={rating}
          disabled={pending}
          onChange={(v) => {
            const prev = rating;
            setRating(v);
            save({ rating: v }, () => setRating(prev));
          }}
        />
      </div>

      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Strategy
        <select className={input} value={t.strategy?.id ?? ""} disabled={pending} onChange={(e) => save({ strategyId: e.target.value || null })}>
          <option value="">None</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Mark as reviewed" toggle. */
export function ReviewedButton({ tradeId, reviewed }: { tradeId: string; reviewed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={reviewed}
      onClick={() =>
        start(async () => {
          await setReviewed(tradeId, !reviewed);
          router.refresh();
          emitTradeChanged();
        })
      }
      className={`inline-flex min-h-10 items-center gap-2 rounded-control border px-3.5 text-[13px] disabled:opacity-60 ${reviewed ? "border-[var(--profit-border)] bg-profit-bg text-profit" : "border-line-strong bg-card text-ink hover:bg-nav-active"}`}
    >
      {reviewed ? "✓ Reviewed" : "Mark as reviewed"}
    </button>
  );
}
