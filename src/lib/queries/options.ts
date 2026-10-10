import { db } from "@/lib/db";
import { currencyChoices, loadRates } from "@/lib/fx";

export interface FilterOptions {
  accounts: { id: string; name: string }[];
  tagGroups: { id: string; name: string; tags: { id: string; name: string }[] }[];
  strategies: { id: string; name: string }[];
  symbols: string[];
  currencies: string[];
  timezone: string;
}

/** Choices for the global filter bar and the advanced filter panel. Small tables; safe to load on every page. */
export async function loadFilterOptions(): Promise<FilterOptions> {
  const [accounts, groups, strategies, symbols, settings, rates] = await Promise.all([
    db.account.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.tagCategory.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, tags: { orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
    db.strategy.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.symbolConfig.findMany({ select: { symbol: true }, orderBy: { symbol: "asc" } }),
    db.setting.findUnique({ where: { id: 1 } }),
    loadRates(),
  ]);
  return {
    accounts,
    tagGroups: groups.filter((g) => g.tags.length > 0),
    strategies,
    symbols: symbols.map((s) => s.symbol),
    currencies: currencyChoices(rates, settings?.displayCurrency ?? "AUD"),
    timezone: settings?.displayTimezone ?? "Asia/Hong_Kong",
  };
}
