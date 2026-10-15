import { EVENT_TFS, SETUP_TFS } from "./constants";

/**
 * Values a link can put into the "new scenario" form, e.g.
 * /training/new?title=Short%20at%204170&at=2026-10-14T03:15:00Z&side=SHORT&entryLow=4168.5&entryHigh=4170&stopLoss=4173.79&takeProfit=4125.02
 * Nothing is saved by opening such a link: it only fills in the form for you to check and save. Anything that does not
 * look right is ignored, so a mangled link just gives a less filled-in form.
 */
export interface Prefill {
  title?: string;
  kind?: "SETUP" | "EVENT";
  /** the decision moment as a UTC ISO string */
  at?: string;
  timeframe?: string;
  horizon?: number;
  lookback?: number;
  side?: "LONG" | "SHORT";
  entryLow?: number;
  entryHigh?: number;
  stopLoss?: number;
  takeProfit?: number;
  notes?: string;
  difficulty?: 1 | 2 | 3;
}

const num = (v: string | undefined, min: number, max: number): number | undefined => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export function parsePrefill(params: Record<string, string | string[] | undefined>): Prefill {
  const get = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim();
  };
  const out: Prefill = {};

  const title = get("title");
  if (title) out.title = title.slice(0, 120);
  const notes = get("notes");
  if (notes) out.notes = notes.slice(0, 4000);

  const kind = get("kind");
  if (kind === "SETUP" || kind === "EVENT") out.kind = kind;

  const at = get("at");
  if (at && !Number.isNaN(Date.parse(at))) out.at = new Date(at).toISOString();

  const tf = get("timeframe");
  const allowed: readonly string[] = out.kind === "EVENT" ? EVENT_TFS : SETUP_TFS;
  if (tf && allowed.includes(tf)) out.timeframe = tf;

  const horizon = num(get("horizon"), 5, 1440);
  if (horizon != null) out.horizon = Math.round(horizon);
  const lookback = num(get("lookback"), 1, 120);
  if (lookback != null) out.lookback = Math.round(lookback);

  const side = get("side");
  if (side === "LONG" || side === "SHORT") out.side = side;
  for (const k of ["entryLow", "entryHigh", "stopLoss", "takeProfit"] as const) {
    const n = num(get(k), 0.00001, 1e9);
    if (n != null) out[k] = n;
  }
  const d = num(get("difficulty"), 1, 3);
  if (d != null) out.difficulty = Math.round(d) as 1 | 2 | 3;
  return out;
}

/** The query string for a link that prefills the form with these values. */
export function prefillQuery(p: Prefill): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
}
