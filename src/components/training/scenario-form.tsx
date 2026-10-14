"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { deleteScenarioAction, removeScenarioImageAction, saveScenarioAction, uploadScenarioImage } from "@/app/(app)/training/actions";
import { cn } from "@/lib/cn";
import type { Candle } from "@/lib/market-data/types";
import type { ScenarioEdit } from "@/lib/training/scenarios";
import { EVENT_TFS, SETUP_TFS, TF_NAMES } from "@/lib/training/constants";
import { TrainingChart, type ChartLine } from "./training-chart";
import { useApi } from "./use-api";

const input = "min-h-10 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink focus:border-accent focus:outline-none";
const label = "flex flex-col gap-1.5 text-xs text-muted";

type Pick = "entryLow" | "entryHigh" | "stopLoss" | "takeProfit";
const PICKS: { id: Pick; label: string }[] = [
  { id: "entryLow", label: "Entry zone: bottom" },
  { id: "entryHigh", label: "Entry zone: top" },
  { id: "stopLoss", label: "Stop loss" },
  { id: "takeProfit", label: "Take profit" },
];

const toLocal = (iso: string, tz: string) => (iso ? format(new TZDate(iso, tz), "yyyy-MM-dd'T'HH:mm") : "");
const fromLocal = (local: string, tz: string): string | null => {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return m ? new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, tz).toISOString() : null;
};

/**
 * Author a training scenario: pick the moment, mark the expert answer on the real chart (you can see the future here),
 * explain it, and attach your annotated screenshot.
 */
export function ScenarioForm({ initial, strategies, tz, tzOffsetMin, startKind = "SETUP" }: { initial: ScenarioEdit | null; startKind?: "SETUP" | "EVENT"; strategies: { id: string; name: string }[]; tz: string; tzOffsetMin: number }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: initial?.title ?? "",
    symbol: initial?.symbol ?? "XAUUSD",
    kind: initial?.kind ?? startKind,
    at: toLocal(initial?.decisionAt ?? "", tz),
    timeframe: initial?.timeframe ?? (startKind === "EVENT" ? "S5" : "M5"),
    horizon: String(initial?.horizonMinutes ?? (startKind === "EVENT" ? 30 : 240)),
    lookback: String(initial?.lookbackHours ?? (startKind === "EVENT" ? 1 : 24)),
    side: (initial?.side ?? "") as "" | "LONG" | "SHORT",
    entryLow: initial?.entryLow != null ? String(initial.entryLow) : "",
    entryHigh: initial?.entryHigh != null ? String(initial.entryHigh) : "",
    stopLoss: initial?.stopLoss != null ? String(initial.stopLoss) : "",
    takeProfit: initial?.takeProfit != null ? String(initial.takeProfit) : "",
    notes: initial?.notes ?? "",
    strategyId: initial?.strategyId ?? "",
    difficulty: String(initial?.difficulty ?? 2),
  });
  const [pick, setPick] = useState<Pick | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? null);

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const tfs = f.kind === "EVENT" ? EVENT_TFS : SETUP_TFS;
  const iso = fromLocal(f.at, tz);
  const decisionT = iso ? Math.floor(Date.parse(iso) / 1000) : null;

  const loadChart = () => {
    if (!iso) return setError("Enter the decision time first.");
    setError(null);
    const q = new URLSearchParams({ symbol: f.symbol, at: iso, tf: f.timeframe, kind: f.kind, lookback: f.lookback, horizon: f.horizon });
    setPreviewUrl(`/api/training/preview?${q}`);
  };
  const { data: preview, error: previewError, loading } = useApi<{ candles: Candle[]; incomplete: boolean }>(previewUrl);

  const onPick = useCallback(
    (price: number) => {
      if (!pick) return;
      const v = price.toFixed(2);
      setF((s) => {
        const next = { ...s, [pick]: v };
        const low = Number(next.entryLow);
        if (pick === "stopLoss" && Number.isFinite(low) && next.entryLow) next.side = Number(v) < low ? "LONG" : "SHORT";
        return next;
      });
      const order: Pick[] = ["entryLow", "entryHigh", "stopLoss", "takeProfit"];
      setPick(order[order.indexOf(pick) + 1] ?? null);
    },
    [pick],
  );

  const lines: ChartLine[] = [];
  if (Number(f.stopLoss) > 0) lines.push({ price: Number(f.stopLoss), color: "#F26B6F", title: "SL", dashed: true });
  if (Number(f.takeProfit) > 0) lines.push({ price: Number(f.takeProfit), color: "#3DD39A", title: "TP", dashed: true });
  const lo = Number(f.entryLow);
  const hi = Number(f.entryHigh);
  const bands = lo > 0 && hi > 0 ? [{ low: Math.min(lo, hi), high: Math.max(lo, hi), rgb: "127, 183, 240", alpha: 0.22, label: "Entry zone", fromT: decisionT ?? undefined }] : [];

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = JSON.stringify({ title: f.title, symbol: f.symbol, kind: f.kind, decisionAt: iso ?? "", timeframe: f.timeframe, horizonMinutes: f.horizon, lookbackHours: f.lookback, side: f.side || undefined, entryLow: f.entryLow, entryHigh: f.entryHigh, stopLoss: f.stopLoss, takeProfit: f.takeProfit, notes: f.notes, strategyId: f.strategyId || undefined, difficulty: f.difficulty });
    const r = await saveScenarioAction(initial?.id ?? null, body);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    if (file) {
      const fd = new FormData();
      fd.set("image", file);
      const up = await uploadScenarioImage(r.id, fd);
      if (!up.ok) {
        setBusy(false);
        setError(`The scenario was saved, but the screenshot was not: ${up.error}`);
        return router.replace(`/training/${r.id}/edit`);
      }
    }
    router.push(`/training/${r.id}`);
    router.refresh();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={loadChart} className="min-h-10 rounded-control bg-accent px-4 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
            {previewUrl ? "Reload chart" : "Load chart"}
          </button>
          <span className="text-xs text-muted">{loading ? "Loading prices…" : "Shows the real prices around the decision time, including what happens next, so you can mark the answer."}</span>
        </div>
        {previewError && (
          <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
            {previewError}
          </p>
        )}
        {preview && preview.candles.length > 0 ? (
          <>
            <TrainingChart candles={preview.candles} tzOffsetMin={tzOffsetMin} height={460} lines={lines} bands={bands} decisionT={decisionT ?? undefined} decisionLabel="Decision point" onPick={pick ? onPick : undefined} crosshairCursor={!!pick} visibleBars={160} />
            <p className="text-xs text-muted">{pick ? `Click the chart to set: ${PICKS.find((p) => p.id === pick)?.label}.` : "Choose a field on the right (Pick on chart), then click the chart."}</p>
          </>
        ) : (
          !loading && !previewError && <div className="flex h-[300px] items-center justify-center rounded-control border border-line bg-inset text-sm text-muted">Set the date and time, then Load chart.</div>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-3 rounded-card border border-line bg-card p-4">
          <label className={label}>
            Title
            <input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="e.g. NY open, sweep of Asia high" className={input} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Kind
              <select
                value={f.kind}
                onChange={(e) => {
                  const k = e.target.value as "SETUP" | "EVENT";
                  setF((s) => ({ ...s, kind: k, timeframe: k === "EVENT" ? "S5" : "M5", horizon: k === "EVENT" ? "30" : "240", lookback: k === "EVENT" ? "1" : "24" }));
                }}
                className={input}
              >
                <option value="SETUP">Mark the setup</option>
                <option value="EVENT">News event (live, 5s)</option>
              </select>
            </label>
            <label className={label}>
              Symbol
              <input value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} className={input} />
            </label>
          </div>
          <label className={label}>
            Decision time (your timezone, {tz})
            <input type="datetime-local" value={f.at} onChange={(e) => set("at", e.target.value)} className={input} />
            <span className="text-[11px]">{f.kind === "EVENT" ? "The moment the replay starts, for example 1 minute before the release." : "The chart is hidden after this moment; the trade is judged on what follows."}</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>
              Timeframe
              <select value={f.timeframe} onChange={(e) => set("timeframe", e.target.value)} className={input}>
                {tfs.map((t) => (
                  <option key={t} value={t}>
                    {TF_NAMES[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Context (h)
              <input inputMode="numeric" value={f.lookback} onChange={(e) => set("lookback", e.target.value)} className={input} />
            </label>
            <label className={label}>
              Follow (min)
              <input inputMode="numeric" value={f.horizon} onChange={(e) => set("horizon", e.target.value)} className={input} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Difficulty
              <select value={f.difficulty} onChange={(e) => set("difficulty", e.target.value)} className={input}>
                <option value="1">★ Easy</option>
                <option value="2">★★ Medium</option>
                <option value="3">★★★ Hard</option>
              </select>
            </label>
            <label className={label}>
              Playbook
              <select value={f.strategyId} onChange={(e) => set("strategyId", e.target.value)} className={input}>
                <option value="">None</option>
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-3 rounded-card border border-line bg-card p-4">
          <h3 className="text-[15px] font-semibold">Expert answer</h3>
          <p className="text-xs text-muted">Optional, but needed to score matches. The entry is a zone; the stop is the invalidation level; the target is where you expect price to go.</p>
          <div role="group" aria-label="Direction" className="grid grid-cols-2 gap-2">
            {(["LONG", "SHORT"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={f.side === s} onClick={() => set("side", f.side === s ? "" : s)} className={cn("min-h-10 rounded-control border text-sm font-semibold", f.side === s ? (s === "LONG" ? "border-profit bg-profit-bg text-profit" : "border-loss bg-loss-bg text-loss") : "border-line-strong text-muted hover:text-ink")}>
                {s === "LONG" ? "Long" : "Short"}
              </button>
            ))}
          </div>
          {PICKS.map((p) => (
            <label key={p.id} className={label}>
              <span className="flex items-center justify-between">
                {p.label}
                <button type="button" disabled={!preview} onClick={() => setPick(p.id)} className={cn("rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40", pick === p.id ? "bg-accent/20 text-accent" : "hover:text-ink")}>
                  {pick === p.id ? "Click the chart…" : "Pick on chart"}
                </button>
              </span>
              <input inputMode="decimal" value={f[p.id]} onChange={(e) => set(p.id, e.target.value)} placeholder="price" className={input} />
            </label>
          ))}
        </div>

        <div className="space-y-3 rounded-card border border-line bg-card p-4">
          <label className={label}>
            Why (shown after the attempt)
            <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={5} maxLength={4000} placeholder="Bias, the zone, the sweep, the target liquidity…" className={cn(input, "py-2")} />
          </label>
          <div className={label}>
            Your annotated screenshot (shown after the attempt)
            {imageUrl && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Current screenshot" className="h-16 w-24 rounded border border-line object-cover" />
                {initial && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("Remove this screenshot?")) return;
                      await removeScenarioImageAction(initial.id);
                      setImageUrl(null);
                    }}
                    className="text-xs text-loss underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
            <span className="text-[11px]">PNG, JPEG, WebP or GIF, up to 8 MB. On the live site this needs a Vercel Blob store (see the README).</span>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-control bg-loss-bg px-3 py-2 text-sm text-loss">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={save} className="min-h-11 rounded-control bg-accent px-6 text-sm font-semibold text-bg hover:bg-[var(--accent-hover)] disabled:opacity-60">
            {busy ? "Saving…" : "Save scenario"}
          </button>
          {initial && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Delete this scenario and all attempts on it? This cannot be undone.")) return;
                await deleteScenarioAction(initial.id);
                router.push("/training");
                router.refresh();
              }}
              className="min-h-11 rounded-control border border-[var(--loss-border)] px-4 text-[13px] text-loss hover:bg-loss-bg"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
