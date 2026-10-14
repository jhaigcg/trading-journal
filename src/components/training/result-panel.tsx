"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Expert } from "@/lib/training/match";
import { rrOf } from "@/lib/training/sim";
import type { Answer, AttemptResult } from "@/lib/training/service";

const f2 = (n: number) => n.toFixed(2);
const sign = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;

/** The reveal: how the trade played out, how it compares with the expert, the notes and your annotated screenshot. */
export function ResultPanel({
  result,
  answer,
  onAgain,
  nextHref,
}: {
  /** an attempt that was judged; or, when the player gave up, only the answer */
  result: AttemptResult | null;
  answer?: Answer | null;
  onAgain: () => void;
  nextHref: string | null;
}) {
  const expert: Expert | null = result?.expert ?? answer?.expert ?? null;
  const notes = result?.notes ?? answer?.notes ?? null;
  const imageUrl = result?.imageUrl ?? answer?.imageUrl ?? null;
  const sim = result?.sim;
  const total = result?.match?.total ?? null;

  let headline = "Here is the expert answer";
  let tone = "text-ink";
  if (sim) {
    if (!sim.filled) {
      headline = "Your order was never filled: price did not reach your entry";
      tone = "text-muted";
    } else if (sim.outcome === "TP") {
      headline = `Target hit: ${sign(sim.r ?? 0)}R`;
      tone = "text-profit";
    } else if (sim.outcome === "SL") {
      headline = `Stopped out: ${sign(sim.r ?? 0)}R`;
      tone = "text-loss";
    } else {
      headline = `Still open when the window ended: ${sign(sim.r ?? 0)}R`;
      tone = (sim.r ?? 0) >= 0 ? "text-profit" : "text-loss";
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-line bg-card p-4">
        <h2 className={cn("text-lg font-semibold", tone)}>{headline}</h2>
        {result && (
          <p className="mt-1 text-xs text-muted">
            Judged on the real candles that followed. If a single candle reached both your stop and your target, the stop is assumed, so the result never flatters you.
            {result.attemptsBefore > 0 && ` Attempt ${result.attemptsBefore + 1}${result.bestMatch != null ? `, best match so far ${result.bestMatch}` : ""}.`}
          </p>
        )}
        {sim?.filled && (
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Result</dt>
              <dd className="num font-semibold">{sign(sim.r ?? 0)}R</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Worst against you</dt>
              <dd className="num font-semibold text-loss">−{f2(sim.maeR ?? 0)}R</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Best in your favour</dt>
              <dd className="num font-semibold text-profit">+{f2(sim.mfeR ?? 0)}R</dd>
            </div>
          </dl>
        )}
      </div>

      {result?.match && (
        <div className="rounded-card border border-line bg-card p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold">Match with the expert</h3>
            <span className="num text-2xl font-semibold text-accent">
              {total}
              <span className="text-sm text-muted"> / 100</span>
            </span>
          </div>
          <ul className="mt-3 space-y-3">
            {result.match.parts.map((p) => (
              <li key={p.key}>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-medium">{p.label}</span>
                  <span className="num text-muted">
                    {p.points} / {p.max}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className={cn("h-full rounded-full", p.points >= p.max * 0.8 ? "bg-profit" : p.points >= p.max * 0.4 ? "bg-accent" : "bg-loss")} style={{ width: `${(p.points / p.max) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">{p.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && !result.match && (
        <p className="rounded-card border border-line bg-card p-4 text-sm text-muted">This scenario has no expert answer, so it was judged on the result alone.</p>
      )}

      {expert && (
        <div className="rounded-card border border-line bg-card p-4">
          <h3 className="text-[15px] font-semibold">Your trade and the expert&rsquo;s</h3>
          <table className="mt-2 w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 font-medium" />
                <th className="py-1.5 text-right font-medium">You</th>
                <th className="py-1.5 text-right font-medium">Expert</th>
              </tr>
            </thead>
            <tbody className="num">
              <tr className="border-t border-line">
                <td className="py-1.5 font-sans text-muted">Direction</td>
                <td className="py-1.5 text-right">{result ? (result.order.side === "LONG" ? "Long" : "Short") : "—"}</td>
                <td className="py-1.5 text-right">{expert.side === "LONG" ? "Long" : "Short"}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 font-sans text-muted">Entry</td>
                <td className="py-1.5 text-right">{result ? f2(result.order.entry) : "—"}</td>
                <td className="py-1.5 text-right">
                  {f2(expert.entryLow)} to {f2(expert.entryHigh)}
                </td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 font-sans text-muted">Stop loss</td>
                <td className="py-1.5 text-right">{result ? f2(result.order.stopLoss) : "—"}</td>
                <td className="py-1.5 text-right">{f2(expert.stopLoss)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 font-sans text-muted">Take profit</td>
                <td className="py-1.5 text-right">{result ? f2(result.order.takeProfit) : "—"}</td>
                <td className="py-1.5 text-right">{f2(expert.takeProfit)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 font-sans text-muted">Risk to reward</td>
                <td className="py-1.5 text-right">{result ? `1 : ${f2(rrOf(result.order))}` : "—"}</td>
                <td className="py-1.5 text-right">1 : {f2(rrOf({ side: expert.side, entry: (expert.entryLow + expert.entryHigh) / 2, stopLoss: expert.stopLoss, takeProfit: expert.takeProfit }))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {notes && (
        <div className="rounded-card border border-line bg-card p-4">
          <h3 className="text-[15px] font-semibold">Why</h3>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed">{notes}</p>
        </div>
      )}

      {imageUrl && (
        <div className="rounded-card border border-line bg-card p-4">
          <h3 className="text-[15px] font-semibold">The expert&rsquo;s chart</h3>
          <a href={imageUrl} target="_blank" rel="noreferrer" className="mt-2 block" title="Open full size">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="The expert's annotated chart for this scenario" className="max-h-[480px] w-full rounded-control border border-line object-contain" />
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAgain} className="min-h-11 rounded-control border border-line-strong px-4 text-[13px] hover:bg-nav-active">
          Try this one again
        </button>
        {nextHref && (
          <Link href={nextHref} className="inline-flex min-h-11 items-center rounded-control bg-accent px-5 text-[13px] font-semibold text-bg hover:bg-[var(--accent-hover)]">
            Next scenario
          </Link>
        )}
        <Link href="/training" className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-4 text-[13px] hover:bg-nav-active">
          All scenarios
        </Link>
      </div>
    </div>
  );
}
