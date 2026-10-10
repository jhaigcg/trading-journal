import { db } from "@/lib/db";

export interface Rate {
  base: string;
  quote: string;
  rate: number;
}

/**
 * Manual FX rate lookup: direct, inverse, or via USD. Returns null when no rate is known
 * (the UI then simply does not offer that currency, so no rate is ever invented).
 */
export function findRate(rates: Rate[], from: string, to: string): number | null {
  if (from === to) return 1;
  const direct = rates.find((r) => r.base === from && r.quote === to);
  if (direct) return direct.rate;
  const inverse = rates.find((r) => r.base === to && r.quote === from);
  if (inverse) return 1 / inverse.rate;
  if (from !== "USD" && to !== "USD") {
    const a = findRate(rates, from, "USD");
    const b = findRate(rates, "USD", to);
    if (a != null && b != null) return a * b;
  }
  return null;
}

export async function loadRates(): Promise<Rate[]> {
  return (await db.fxRate.findMany()).map((r) => ({ base: r.base, quote: r.quote, rate: Number(r.rate) }));
}

/** Home currency plus every currency we can convert it to. */
export function currencyChoices(rates: Rate[], home: string): string[] {
  const all = new Set([home, ...rates.flatMap((r) => [r.base, r.quote])]);
  return [...all].filter((c) => findRate(rates, home, c) != null).sort((a, b) => (a === home ? -1 : b === home ? 1 : a.localeCompare(b)));
}

/** Display currency and the multiplier from the home currency; falls back to home when no rate is known. */
export async function displayCurrency(requested?: string): Promise<{ currency: string; fx: number; home: string }> {
  const [settings, rates] = await Promise.all([db.setting.findUnique({ where: { id: 1 } }), loadRates()]);
  const home = settings?.displayCurrency ?? "AUD";
  const rate = requested ? findRate(rates, home, requested) : 1;
  return rate == null ? { currency: home, fx: 1, home } : { currency: requested ?? home, fx: rate, home };
}
