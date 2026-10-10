"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { brokerFor, SERVER_PATTERN } from "@/lib/brokers/servers";
import { db } from "@/lib/db";
import { changeBrokerTimeMode, hashToken, newIngestToken } from "@/lib/import/ea";
import { MetaApiError, metaapiConfigured, provisionAccount, removeAccount } from "@/lib/import/metaapi";
import { appOrigin } from "@/lib/origin";
import { getSession } from "@/lib/session";
import { isValidBrokerTimeMode } from "@/lib/time";

export type ConnectState = { error?: string; accountId?: string } | undefined;

const schema = z.object({
  name: z.string().trim().min(1, "Give the account a name.").max(80),
  login: z.string().trim().regex(/^\d{3,12}$/, "The MT4 login is the account number (digits only)."),
  investorPassword: z.string().min(1, "Enter the investor (read-only) password."),
  server: z.string().trim().min(2, "Enter the broker server name exactly as shown in MT4, e.g. ICMarketsSC-Live01."),
  broker: z.string().trim().max(80).optional(),
  startingBalance: z.coerce.number().min(0, "Starting balance cannot be negative."),
  backfillFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date to import history from."),
});

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

/**
 * Connect an MT4 account through MetaApi. The investor password is forwarded to MetaApi once and is
 * deliberately never stored, logged or returned: only the resulting MetaApi account id is kept.
 */
export async function connectAccount(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  await requireSession();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  if (!metaapiConfigured()) return { error: "MetaApi is not configured: set METAAPI_TOKEN in the server environment (see README)." };
  if (await db.account.findFirst({ where: { platform: "MT4", mtLogin: v.login } })) return { error: "An account with this MT4 login is already connected." };

  let metaId: string;
  try {
    metaId = (await provisionAccount({ name: v.name, login: v.login, investorPassword: v.investorPassword, server: v.server, platform: "mt4", brokerKeywords: v.broker ? [v.broker] : undefined })).id;
  } catch (e) {
    if (e instanceof MetaApiError) return { error: e.message };
    return { error: "Could not reach MetaApi. Try again in a moment." };
  }

  const account = await db.account.create({
    data: {
      name: v.name,
      broker: v.broker || null,
      platform: "MT4",
      mtLogin: v.login,
      mtServer: v.server,
      metaapiAccountId: metaId,
      currency: "AUD",
      startingBalance: v.startingBalance,
      syncType: "AUTO_METAAPI",
      backfillFrom: new Date(`${v.backfillFrom}T00:00:00Z`),
    },
  });
  revalidatePath("/accounts");
  return { accountId: account.id };
}

/** Stop syncing: removes the account from MetaApi. Trades already imported stay in the journal. */
export async function disconnectAccount(form: FormData) {
  await requireSession();
  const id = String(form.get("accountId") ?? "");
  const acc = await db.account.findUnique({ where: { id } });
  if (!acc) return;
  if (acc.metaapiAccountId) {
    try {
      await removeAccount(acc.metaapiAccountId);
    } catch (e) {
      // already gone on MetaApi's side is fine; anything else keeps the link so I can retry
      if (!(e instanceof MetaApiError && e.status === 404)) return;
    }
  }
  await db.account.update({ where: { id }, data: { metaapiAccountId: null, ingestTokenHash: null, syncType: "MANUAL", syncCursor: null, syncingUntil: null } });
  revalidatePath("/accounts");
}

// ───────────── MT4 Expert Advisor (free) ─────────────

export type EaState = { error?: string; token?: string; endpoint?: string; accountId?: string } | undefined;

const eaSchema = z.object({
  login: z.string().trim().regex(/^\d{3,12}$/, "The MT4 login is the account number (digits only)."),
  server: z.string().trim().regex(SERVER_PATTERN, "Enter the broker server name, for example ICMarketsSC-Live01."),
});

async function ingestEndpoint() {
  return `${appOrigin(await headers())}/api/ingest/mt4`;
}

/** Create an account fed by the LedgerSync EA. The token is returned once; only its hash is stored. */
export async function createEaAccount(_prev: EaState, form: FormData): Promise<EaState> {
  await requireSession();
  const parsed = eaSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (await db.account.findFirst({ where: { platform: "MT4", mtLogin: v.login } })) return { error: "An account with this MT4 login already exists." };

  const token = newIngestToken();
  const account = await db.account.create({
    data: {
      name: `MT4 · ${v.login}`,
      platform: "MT4",
      mtLogin: v.login,
      mtServer: v.server,
      broker: brokerFor(v.server),
      currency: "AUD",
      startingBalance: 0, // history normally includes the first deposit; change it on the account if yours does not
      syncType: "AUTO_EA",
      brokerTimeMode: "NYCLOSE", // the most common MT4 server clock; the page warns if the EA reports a different one
      ingestTokenHash: hashToken(token),
    },
  });
  revalidatePath("/accounts");
  return { token, endpoint: await ingestEndpoint(), accountId: account.id };
}

/** Replace the EA token. The old one stops working immediately. */
export async function regenerateEaToken(_prev: EaState, form: FormData): Promise<EaState> {
  await requireSession();
  const id = String(form.get("accountId") ?? "");
  const acc = await db.account.findUnique({ where: { id } });
  if (!acc || acc.syncType !== "AUTO_EA") return { error: "This account does not use the MT4 EA." };
  const token = newIngestToken();
  await db.account.update({ where: { id }, data: { ingestTokenHash: hashToken(token) } });
  revalidatePath("/accounts");
  return { token, endpoint: await ingestEndpoint(), accountId: id };
}

export type TimeModeState = { error?: string; ok?: string } | undefined;

/** Change how the broker server clock maps to UTC and re-convert every stored trade time. */
export async function updateBrokerTime(_prev: TimeModeState, form: FormData): Promise<TimeModeState> {
  await requireSession();
  const id = String(form.get("accountId") ?? "");
  const mode = String(form.get("brokerTimeMode") ?? "");
  if (!isValidBrokerTimeMode(mode)) return { error: "Unknown broker time setting." };
  try {
    const r = await changeBrokerTimeMode(id, mode);
    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    return { ok: `Re-converted ${r.trades} trades.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not update the time setting." };
  }
}
