import { Download } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { TradingDays } from "@/components/progress/rule-controls";
import { DisplayForm, PasswordForm, RatesEditor, SymbolRow, TagsEditor } from "@/components/settings/forms";
import { Card, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/db";
import { loadRates } from "@/lib/fx";

export const metadata: Metadata = { title: "Settings" };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader title={title} />
      {hint && <p className="mb-3 mt-1 text-xs text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </Card>
  );
}

export default async function SettingsPage() {
  const [settings, rates, symbols, groups, tagCounts] = await Promise.all([
    db.setting.findUnique({ where: { id: 1 } }),
    loadRates(),
    db.symbolConfig.findMany({ orderBy: { symbol: "asc" } }),
    db.tagCategory.findMany({ orderBy: { position: "asc" }, include: { tags: { orderBy: { name: "asc" } } } }),
    db.tradeTag.groupBy({ by: ["tagId"], _count: { _all: true } }),
  ]);
  const counts = new Map(tagCounts.map((c) => [c.tagId, c._count._all]));
  const home = settings?.displayCurrency ?? "AUD";
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

  return (
    <div className="max-w-[860px]">
      <PageHeader title="Settings" eyebrow="Account" />

      <Section title="Display and results" hint="How days, money and wins and losses are worked out everywhere in the app.">
        <DisplayForm timezone={settings?.displayTimezone ?? "Asia/Hong_Kong"} currency={home} threshold={Number(settings?.breakevenThreshold ?? 0)} zones={zones} />
      </Section>

      <Section title="Trading days" hint="Only these weekdays are judged on the Progress page. Days off never break a streak.">
        <TradingDays days={settings?.tradingDays?.length ? settings.tradingDays : [1, 2, 3, 4, 5]} />
      </Section>

      <Section title="Tags" hint="Groups and tags you can put on trades. Renaming keeps every tagged trade; deleting removes the tag from them.">
        <TagsEditor groups={groups.map((g) => ({ id: g.id, name: g.name, tags: g.tags.map((t) => ({ id: t.id, name: t.name, trades: counts.get(t.id) ?? 0 })) }))} />
      </Section>

      <Section title="Currency rates">
        <RatesEditor rates={rates} home={home} />
      </Section>

      <Section title="Symbols" hint="Pip and contract size drive pips, risk and the running P&L. Symbols are added automatically when you import trades. Trades already saved keep the pips they were saved with.">
        {symbols.length === 0 ? (
          <p className="text-sm text-muted">No symbols yet. They appear after your first import.</p>
        ) : (
          <ul className="divide-y divide-line">
            {symbols.map((s) => (
              <SymbolRow key={s.symbol} symbol={s.symbol} pipSize={Number(s.pipSize)} contractSize={Number(s.contractSize)} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Your data">
        <p className="mb-3 text-sm text-muted">Download every trade, from every account, as a spreadsheet file. It is a plain backup you can open in Excel or Google Sheets.</p>
        <a href="/api/export/trades" className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line-strong px-4 text-[13px] hover:bg-nav-active">
          <Download size={14} aria-hidden /> Export all trades (CSV)
        </a>
      </Section>

      <Section title="Password">
        <PasswordForm />
      </Section>
    </div>
  );
}
