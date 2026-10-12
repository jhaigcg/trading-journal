import type { Metadata } from "next";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ResyncButton } from "@/components/sync/sync-controls";
import { Card, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { metaapiConfigured } from "@/lib/import/metaapi";
import { brokerOffsetMinutesAt } from "@/lib/time";
import { BrokerTimeForm } from "./broker-time-form";
import { ConnectForm } from "./connect-form";
import { DisconnectButton } from "./disconnect-button";
import { ConnectEaForm, RegenerateToken } from "./ea-setup";

export const metadata: Metadata = { title: "Accounts and import" };

export const maxDuration = 60; // changing the broker-time setting re-converts every stored trade

const yearAgo = () => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const nowDate = () => new Date();
const ONLINE_WITHIN_MS = 10 * 60_000;

const gmt = (min: number) => `GMT${min >= 0 ? "+" : "−"}${Math.abs(min) / 60}`;

export default async function AccountsPage() {
  const [accounts, counts] = await Promise.all([
    db.account.findMany({ where: { archived: false }, orderBy: { createdAt: "asc" } }),
    db.trade.groupBy({ by: ["accountId"], _count: true }),
  ]);
  const tradeCount = new Map(counts.map((c) => [c.accountId, c._count]));
  const knownServers = [...new Set(accounts.map((a) => a.mtServer).filter((s): s is string => !!s))];
  const now = nowDate();

  return (
    <>
      <PageHeader title="Accounts & import">
        <Link href="/trades/new" className="inline-flex min-h-10 items-center rounded-control border border-line-strong bg-card px-3.5 text-[13px] hover:bg-nav-active">
          + Add trade manually
        </Link>
      </PageHeader>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Your accounts" />
          {accounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No accounts yet. Connect your MT4 account below.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13px] max-md:block md:min-w-[760px]">
                <thead className="max-md:hidden">
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5 font-medium">Account</th>
                    <th className="px-3 py-2.5 font-medium">Platform</th>
                    <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                    <th className="px-3 py-2.5 text-right font-medium">Trades</th>
                    <th className="px-3 py-2.5 font-medium">Sync</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="max-md:block">
                  {accounts.map((a) => {
                    const viaEa = a.syncType === "AUTO_EA";
                    const viaMeta = !!a.metaapiAccountId;
                    const online = a.lastHeartbeatAt != null && now.getTime() - a.lastHeartbeatAt.getTime() < ONLINE_WITHIN_MS;
                    const expected = brokerOffsetMinutesAt(now, a.brokerTimeMode);
                    const clockMismatch = viaEa && online && a.lastReportedOffsetMin != null && a.lastReportedOffsetMin !== expected;
                    return (
                      <tr key={a.id} className="border-b border-[var(--row-line)] align-top max-md:mb-3 max-md:block max-md:rounded-card max-md:border max-md:border-line max-md:p-3">
                        <td className="px-3 py-3 max-md:block max-md:px-0 max-md:py-1">
                          <div className="font-semibold">{a.name}</div>
                          <div className="text-xs text-muted">{a.broker ?? "—"}</div>
                        </td>
                        <td data-label="Platform" className="px-3 py-3 max-md:block max-md:px-0 max-md:py-1.5 max-md:before:mb-0.5 max-md:before:block max-md:before:text-[11px] max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted max-md:before:content-[attr(data-label)]">
                          <div>{a.platform}</div>
                          <div className="num text-xs text-muted">{a.mtLogin ? `${a.mtLogin}${a.mtServer ? ` @ ${a.mtServer}` : ""}` : "manual"}</div>
                        </td>
                        <td data-label="Balance" className="num px-3 py-3 text-right max-md:flex max-md:items-baseline max-md:justify-between max-md:px-0 max-md:py-1.5 max-md:text-left max-md:before:text-[11px] max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted max-md:before:content-[attr(data-label)]">{a.lastBalance != null ? money(Number(a.lastBalance), a.currency, { signed: false }) : "—"}</td>
                        <td data-label="Trades" className="num px-3 py-3 text-right max-md:flex max-md:items-baseline max-md:justify-between max-md:px-0 max-md:py-1.5 max-md:text-left max-md:before:text-[11px] max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted max-md:before:content-[attr(data-label)]">{tradeCount.get(a.id) ?? 0}</td>
                        <td data-label="Sync" className="px-3 py-3 max-md:block max-md:px-0 max-md:py-1.5 max-md:before:mb-0.5 max-md:before:block max-md:before:text-[11px] max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted max-md:before:content-[attr(data-label)]">
                          {viaEa ? (
                            <div className="flex flex-col gap-1.5 md:max-w-[300px]">
                              <div>
                                {a.lastSyncError ? (
                                  <Pill className="bg-loss-bg text-loss">SYNC ERROR</Pill>
                                ) : !a.lastHeartbeatAt ? (
                                  <Pill className="bg-line text-muted">WAITING FOR EA</Pill>
                                ) : online ? (
                                  <Pill className="bg-profit-bg text-profit">EA ONLINE</Pill>
                                ) : (
                                  <Pill className="bg-line text-ink-2">EA OFFLINE</Pill>
                                )}
                              </div>
                              {a.lastSyncError && <div className="text-xs text-loss">{a.lastSyncError}</div>}
                              <div className="text-xs text-muted">
                                {a.lastHeartbeatAt
                                  ? `Last seen ${formatDistanceToNow(a.lastHeartbeatAt, { addSuffix: true })}${a.lastSyncAt ? ` · trades synced ${formatDistanceToNow(a.lastSyncAt, { addSuffix: true })}` : ""}`
                                  : "Install the EA from the steps below to start syncing."}
                                {!online && a.lastHeartbeatAt && <> Trades made while MT4 was closed arrive the next time it opens.</>}
                              </div>
                              {clockMismatch && (
                                <div role="alert" className="rounded-md bg-loss-bg px-2 py-1.5 text-xs text-loss">
                                  Your broker&rsquo;s server clock is {gmt(a.lastReportedOffsetMin!)} right now, but the setting below gives {gmt(expected)}. Trade times may be off by an hour: pick the matching option.
                                </div>
                              )}
                              <BrokerTimeForm accountId={a.id} mode={a.brokerTimeMode} />
                            </div>
                          ) : !viaMeta ? (
                            <Pill className="bg-line text-muted">MANUAL</Pill>
                          ) : a.lastSyncError ? (
                            <div className="max-w-[260px]">
                              <Pill className="bg-loss-bg text-loss">SYNC ERROR</Pill>
                              <div className="mt-1 text-xs text-loss">{a.lastSyncError}</div>
                            </div>
                          ) : a.lastSyncAt ? (
                            <div>
                              <Pill className="bg-profit-bg text-profit">SYNCED</Pill>
                              <div className="mt-1 text-xs text-muted">{formatDistanceToNow(a.lastSyncAt, { addSuffix: true })}</div>
                            </div>
                          ) : (
                            <Pill className="bg-line text-muted">NOT SYNCED YET</Pill>
                          )}
                        </td>
                        <td className="px-3 py-3 max-md:block max-md:px-0 max-md:pb-0 max-md:pt-2">
                          <div className="flex flex-wrap items-start justify-end gap-1 max-md:justify-start">
                            {viaMeta && <ResyncButton accountIds={[a.id]} variant="button" />}
                            {viaEa && <RegenerateToken accountId={a.id} />}
                            {(viaMeta || viaEa) && <DisconnectButton accountId={a.id} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Accounts using the MT4 EA update as trades close. Accounts connected through MetaApi sync each time you sign in, and once a day as a safety net.</p>
        </Card>

        <Card>
          <CardHeader title="Connect your MT4 account (free)" right="Uses the LedgerSync Expert Advisor" />
          <p className="mt-2 text-sm text-ink-2">
            A small read-only program that runs inside your MT4 and sends your trades here. It never places or changes orders, and it needs no password: just a token that only works for this account.
          </p>
          <p className="mt-2 text-sm text-ink-2">
            Already connected, or updating the EA?{" "}
            <a href="/api/ea/download" className="text-accent underline">
              Download LedgerSync.mq4
            </a>{" "}
            (it has this site&rsquo;s address built in; your existing token still works).
          </p>
          <div className="mt-4">
            <ConnectEaForm knownServers={knownServers} />
          </div>
        </Card>

        <details className="group rounded-card border border-line bg-card">
          <summary className="cursor-pointer list-none px-4 py-3.5 text-[15px] font-semibold marker:hidden">
            Alternative: connect through MetaApi <span className="ml-2 text-xs font-normal text-muted">paid service, no EA needed</span>
          </summary>
          <div className="border-t border-line p-4">
            <ConnectForm configured={metaapiConfigured()} defaultFrom={yearAgo()} />
          </div>
        </details>
      </div>
    </>
  );
}
