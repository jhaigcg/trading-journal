import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken, ingestEaPayload, payloadSchema } from "@/lib/import/ea";
import { warmRecent } from "@/lib/market-data/warm";

export const maxDuration = 60;

const MAX_BODY_BYTES = 2_000_000;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Endpoint for the LedgerSync Expert Advisor running inside MT4.
 * Authenticated by a per-account bearer token (not by the login session); only the token's SHA-256 is stored.
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return json({ ok: false, error: "missing token" }, 401);

  const account = await db.account.findUnique({ where: { ingestTokenHash: hashToken(token) } });
  if (!account || account.archived || account.syncType !== "AUTO_EA") return json({ ok: false, error: "invalid token" }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "payload too large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: `invalid payload: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` }, 400);

  // a token only ever works for the MT4 account it was created for
  if (account.mtLogin && account.mtLogin !== parsed.data.login) {
    return json({ ok: false, error: `this token belongs to MT4 account ${account.mtLogin}, but the EA is logged in as ${parsed.data.login}` }, 409);
  }

  try {
    const result = await ingestEaPayload(account, parsed.data);
    // new trades arrived: fetch the prices around the latest days now, so their charts open instantly
    if (result.trades > 0) after(() => warmRecent(account.id).catch(() => undefined));
    return json({ ok: true, ...result, serverTime: new Date().toISOString() });
  } catch (e) {
    await db.account.update({ where: { id: account.id }, data: { lastSyncError: e instanceof Error ? e.message.slice(0, 300) : "ingest failed" } }).catch(() => undefined);
    return json({ ok: false, error: "ingest failed" }, 500);
  }
}
