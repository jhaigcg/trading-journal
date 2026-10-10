/** Public origin of this deployment (works behind Vercel's proxy and on localhost). */
export function appOrigin(h: { get(name: string): string | null }, fallbackUrl?: string): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? (fallbackUrl ? new URL(fallbackUrl).host : "localhost:3000");
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
