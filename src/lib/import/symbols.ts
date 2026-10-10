export interface SymbolAliasConfig {
  symbol: string;
  aliases: string[];
}

/**
 * Canonical symbol for a broker symbol: exact alias match first (XAUUSD.a, GOLD → XAUUSD),
 * otherwise upper-case with broker suffixes after "." "_" or "-" stripped.
 */
export function normaliseSymbol(raw: string, configs: SymbolAliasConfig[] = []): string {
  const up = raw.trim().toUpperCase();
  for (const c of configs) {
    if (c.symbol.toUpperCase() === up || c.aliases.some((a) => a.toUpperCase() === up)) return c.symbol;
  }
  return up.replace(/[._-].*$/, "");
}
