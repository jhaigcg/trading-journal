import { z } from "zod";
import { instrumentFor } from "@/lib/market-data/dukascopy";
import { validateExpert } from "./match";

import { tfsFor, TF_NAMES } from "./constants";
export { EVENT_TFS, SETUP_TFS, TF_NAMES, tfsFor, type TrainTf } from "./constants";

/** An empty form field arrives as "" or null: treat it as not set. A value that is not a number gets a message naming the field. */
const optNum = (label: string) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number({ error: `${label} must be a number, like 4133.00.` }).finite(`${label} must be a number, like 4133.00.`).positive(`${label} must be above 0.`).max(1e9).optional());

const blank = (v: unknown) => v === "" || v == null;
/** Only one end of the entry zone given: it is a single entry price, so use it for both ends. */
function mirrorEntry(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  if (blank(o.entryHigh) && !blank(o.entryLow)) o.entryHigh = o.entryLow;
  else if (blank(o.entryLow) && !blank(o.entryHigh)) o.entryLow = o.entryHigh;
  return o;
}

const scenarioObject = z
  .object({
    title: z.string().trim().min(1, "Give the scenario a title.").max(120),
    symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,12}$/, "Enter a symbol such as XAUUSD.").refine((s) => instrumentFor(s) != null, "There is no price history for that symbol."),
    kind: z.enum(["SETUP", "EVENT"]),
    decisionAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Enter the decision time.").transform((s) => new Date(s)),
    timeframe: z.string(),
    horizonMinutes: z.coerce.number().int().min(5, "Follow the trade for at least 5 minutes.").max(1440, "At most 24 hours."),
    lookbackHours: z.coerce.number().int().min(1).max(120),
    side: z.enum(["LONG", "SHORT"]).optional(),
    entryLow: optNum("Entry zone: bottom"),
    entryHigh: optNum("Entry zone: top"),
    stopLoss: optNum("Stop loss"),
    takeProfit: optNum("Take profit"),
    notes: z.string().trim().max(4000, "Keep the notes under 4000 characters.").optional(),
    strategyId: z.string().trim().max(40).optional(),
    difficulty: z.coerce.number().int().min(1).max(3).default(2),
  })
  .superRefine((v, ctx) => {
    if (!tfsFor(v.kind).includes(v.timeframe)) ctx.addIssue({ code: "custom", path: ["timeframe"], message: `Choose one of ${tfsFor(v.kind).map((t) => TF_NAMES[t]).join(", ")} for this kind of scenario.` });
    if (v.decisionAt.getTime() > Date.now() - 3600_000) ctx.addIssue({ code: "custom", path: ["decisionAt"], message: "Pick a time at least an hour in the past: prices are published after the fact." });
    const given = [v.side, v.entryLow, v.entryHigh, v.stopLoss, v.takeProfit].filter((x) => x !== undefined).length;
    if (given > 0 && given < 5) ctx.addIssue({ code: "custom", path: ["side"], message: "Fill in the whole expert answer (direction, entry zone, stop loss, take profit) or leave it all empty." });
    if (given === 5) {
      const bad = validateExpert({ side: v.side!, entryLow: v.entryLow!, entryHigh: v.entryHigh!, stopLoss: v.stopLoss!, takeProfit: v.takeProfit! });
      if (bad) ctx.addIssue({ code: "custom", path: ["stopLoss"], message: bad });
    }
  });
export const scenarioSchema = z.preprocess(mirrorEntry, scenarioObject);
export type ScenarioInput = z.infer<typeof scenarioObject>;

export const attemptSchema = z.object({
  side: z.enum(["LONG", "SHORT"]),
  entry: z.coerce.number().finite().positive(),
  stopLoss: z.coerce.number().finite().positive(),
  takeProfit: z.coerce.number().finite().positive(),
  tf: z.string().optional(),
  /** live mode: open time (unix seconds) of the candle the order was placed on */
  entryT: z.coerce.number().int().positive().optional(),
  /** live mode: "limit" rests at `entry` from the moment `entryT` closes until price touches it; "market" (default) fills at that candle's close */
  orderType: z.enum(["market", "limit"]).optional(),
});
export type AttemptInput = z.infer<typeof attemptSchema>;

export const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Check the values and try again.";
