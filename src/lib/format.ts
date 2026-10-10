const SYMBOLS: Record<string, string> = { AUD: "A$", USD: "$", EUR: "€", GBP: "£", HKD: "HK$", CNY: "CN¥" };

export const currencySymbol = (c: string) => SYMBOLS[c] ?? `${c} `;

/** Signed money: +A$1,234.56 / −A$98.00. Zero is shown unsigned. */
export function money(n: number, currency = "AUD", opts: { decimals?: number; signed?: boolean } = {}): string {
  const { decimals = 2, signed = true } = opts;
  const abs = Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = !signed ? (n < 0 ? "−" : "") : n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${currencySymbol(currency)}${abs}`;
}

export const pnlTone = (n: number): "profit" | "loss" | "neutral" => (n > 0 ? "profit" : n < 0 ? "loss" : "neutral");

export const pct = (ratio: number, decimals = 1) => `${(ratio * 100).toFixed(decimals)}%`;

export const ratio = (n: number | null, decimals = 2) => (n == null ? "—" : Number.isFinite(n) ? n.toFixed(decimals) : "∞");

export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
