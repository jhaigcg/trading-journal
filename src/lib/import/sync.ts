import { db } from "@/lib/db";
import { DEFAULT_TZ } from "@/lib/time";
import { MetaApiAdapter } from "./metaapi";
import { persistBalanceEvents, persistTrades, refreshDailySummary, loadSymbols, type PersistContext } from "./persist";
import { buildTrades, type BalanceEventRaw, type BuiltTrade } from "./position-builder";
import type { ImportAdapter, RawDeal } from "./types";

const DAY = 86_400_000;
const WINDOW_MS = 30 * DAY; // history is pulled in 30-day windows so a multi-year backfill is resumable
const OVERLAP_MS = 2 * DAY; // incremental syncs re-read the last 2 days (re-processing is idempotent)
const MAX_FETCH_ROUNDS = 3;
const MAX_POSITION_FETCHES = 40;

export type SyncStatus = "done" | "progress" | "connecting" | "error";

export interface SyncResult {
  status: SyncStatus;
  message?: string;
  /** 0..1 share of the history window that has been processed */
  progress: number;
  created: number;
  updated: number;
}

const dedupe = (deals: RawDeal[]) => [...new Map(deals.map((d) => [d.id, d])).values()];

/** Build trades from deals, fetching any positions the window cut in half (chained partial closes, open-before-window). */
async function resolve(adapter: ImportAdapter, deals: RawDeal[], attempted: Set<string>): Promise<{ trades: BuiltTrade[]; balanceEvents: BalanceEventRaw[] }> {
  let all = dedupe(deals);
  for (let round = 0; round < MAX_FETCH_ROUNDS; round++) {
    const need = buildTrades(all).needPositionIds.filter((id) => !attempted.has(id)).slice(0, MAX_POSITION_FETCHES);
    if (!need.length) break;
    for (const id of need) {
      attempted.add(id);
      try {
        all = dedupe([...all, ...(await adapter.fetchPositionDeals(id))]);
      } catch {
        // a position MetaApi cannot return is simply left as-is; the trade stays incomplete rather than failing the sync
      }
    }
  }
  const r = buildTrades(all);
  return { trades: r.trades, balanceEvents: r.balanceEvents };
}

/**
 * One resumable step of an account sync. Safe to call repeatedly: it advances `syncCursor` window by
 * window within `budgetMs`, then reports `progress` until it reaches "done". Everything is idempotent
 * (trades are upserted on accountId + brokerTicket), so overlapping or repeated calls never duplicate.
 */
async function runSync(
  accountId: string,
  opts: { adapter?: ImportAdapter; budgetMs?: number; now?: Date } = {},
): Promise<SyncResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const now = opts.now ?? new Date();
  const acc = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const adapter = opts.adapter ?? (acc.metaapiAccountId ? new MetaApiAdapter(acc.metaapiAccountId) : null);
  const empty = { progress: 0, created: 0, updated: 0 };
  if (!adapter) return { status: "error", message: "This account is not connected to MT4.", ...empty };

  const fail = async (message: string): Promise<SyncResult> => {
    await db.account.update({ where: { id: accountId }, data: { lastSyncError: message } });
    return { status: "error", message, ...empty };
  };

  try {
    const conn = await adapter.connectionState();
    if (conn.state === "ERROR") return await fail(conn.message ?? "Could not connect to the broker.");
    if (conn.state !== "CONNECTED") return { status: "connecting", message: conn.message ?? "Connecting to your broker…", ...empty };

    const settings = await db.setting.findUnique({ where: { id: 1 } });
    const ctx: PersistContext = {
      accountId,
      tz: settings?.displayTimezone ?? DEFAULT_TZ,
      breakevenThreshold: Number(settings?.breakevenThreshold ?? 0),
      symbols: await loadSymbols(),
    };

    const historyStart = acc.backfillFrom ?? new Date(now.getTime() - 365 * DAY);
    let from = acc.syncCursor ? new Date(Math.max(acc.syncCursor.getTime() - OVERLAP_MS, historyStart.getTime())) : historyStart;
    const attempted = new Set<string>();
    const touched = new Set<string>();
    let created = 0;
    let updated = 0;
    let cursor = acc.syncCursor ?? historyStart;

    while (from < now && Date.now() - started < budget) {
      const to = new Date(Math.min(from.getTime() + WINDOW_MS, now.getTime()));
      const { trades, balanceEvents } = await resolve(adapter, await adapter.fetchDeals(from, to), attempted);
      const r = await persistTrades(ctx, trades);
      await persistBalanceEvents(accountId, balanceEvents);
      created += r.created;
      updated += r.updated;
      r.touchedDays.forEach((d) => touched.add(d));
      cursor = to;
      from = to;
      await db.account.update({ where: { id: accountId }, data: { syncCursor: cursor } });
    }

    if (touched.size) await refreshDailySummary(accountId, [...touched], ctx.breakevenThreshold);

    const caughtUp = from >= now;
    const progress = caughtUp ? 1 : Math.min(0.99, Math.max(0, (cursor.getTime() - historyStart.getTime()) / Math.max(1, now.getTime() - historyStart.getTime())));

    if (!caughtUp) {
      await db.importBatch.create({ data: { accountId, source: "METAAPI", status: "DONE", tradesNew: created, tradesUpd: updated, finishedAt: new Date() } });
      return { status: "progress", progress, created, updated };
    }

    // caught up: refresh live positions, reconcile trades I still think are open, update balances
    const open = await adapter.fetchOpenPositions();
    const openIds = new Set(open.map((d) => d.positionId!));
    const staleOpen = await db.trade.findMany({ where: { accountId, status: "OPEN" }, select: { brokerTicket: true } });
    const stale = staleOpen.map((t) => t.brokerTicket!).filter((id) => !openIds.has(id));
    const staleDeals: RawDeal[] = [];
    for (const id of stale.slice(0, MAX_POSITION_FETCHES)) {
      try {
        staleDeals.push(...(await adapter.fetchPositionDeals(id)));
      } catch {
        /* leave as open; retried on the next sync */
      }
    }
    const final = await resolve(adapter, [...open, ...staleDeals], attempted);
    const fr = await persistTrades(ctx, final.trades);
    await persistBalanceEvents(accountId, final.balanceEvents);
    created += fr.created;
    updated += fr.updated;
    if (fr.touchedDays.length) await refreshDailySummary(accountId, fr.touchedDays, ctx.breakevenThreshold);

    let snapshot: Awaited<ReturnType<ImportAdapter["fetchAccount"]>> | null = null;
    try {
      snapshot = await adapter.fetchAccount();
    } catch {
      /* balance is informational */
    }
    await db.account.update({
      where: { id: accountId },
      data: {
        syncCursor: now,
        lastSyncAt: new Date(),
        lastSyncError: null,
        ...(snapshot ? { lastBalance: snapshot.balance, lastEquity: snapshot.equity, broker: acc.broker ?? snapshot.broker ?? null } : {}),
      },
    });
    await db.importBatch.create({ data: { accountId, source: "METAAPI", status: "DONE", tradesNew: created, tradesUpd: updated, finishedAt: new Date() } });
    return { status: "done", progress: 1, created, updated };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "Sync failed");
  }
}

/** Locked wrapper: at most one sync step runs per account at a time (others are told to wait). */
export async function syncAccountStep(accountId: string, opts: { adapter?: ImportAdapter; budgetMs?: number; now?: Date } = {}): Promise<SyncResult> {
  const budget = opts.budgetMs ?? 40_000;
  const lock = await db.account.updateMany({
    where: { id: accountId, OR: [{ syncingUntil: null }, { syncingUntil: { lt: new Date() } }] },
    data: { syncingUntil: new Date(Date.now() + budget + 30_000) },
  });
  if (lock.count === 0) return { status: "progress", message: "A sync is already running for this account.", progress: 0, created: 0, updated: 0 };
  try {
    return await runSync(accountId, opts);
  } finally {
    await db.account.update({ where: { id: accountId }, data: { syncingUntil: null } }).catch(() => undefined);
  }
}
