/**
 * A starter list of MT4 broker server names for the type-ahead on the connect form. It is a convenience, not a
 * complete directory: brokers add and rename servers, so any name can be typed. The exact name is shown in MT4 under
 * File → Login to Trade Account.
 */
export interface ServerOption {
  server: string;
  broker: string;
}

const range = (n: number, pad = 2) => Array.from({ length: n }, (_, i) => String(i + 1).padStart(pad, "0"));

const BROKERS: { broker: string; servers: string[] }[] = [
  { broker: "IC Markets", servers: ["ICMarketsSC-Demo", "ICMarketsSC-Demo02", ...range(35).map((n) => `ICMarketsSC-Live${n}`)] },
  { broker: "Pepperstone", servers: ["Pepperstone-Demo", "Pepperstone-Live"] },
  { broker: "FP Markets", servers: ["FPMarkets-Demo", "FPMarkets-Live"] },
  { broker: "Eightcap", servers: ["Eightcap-Demo", "Eightcap-Live"] },
  { broker: "Exness", servers: ["Exness-Trial", "Exness-Real", ...Array.from({ length: 20 }, (_, i) => `Exness-Real${i + 2}`)] },
  { broker: "XM", servers: [...Array.from({ length: 5 }, (_, i) => `XMGlobal-Demo ${i + 1}`), ...Array.from({ length: 10 }, (_, i) => `XMGlobal-Real ${i + 1}`)] },
  { broker: "Admiral Markets", servers: ["AdmiralMarkets-Demo", "AdmiralMarkets-Live"] },
  { broker: "Tickmill", servers: ["Tickmill-Demo", "Tickmill-Live"] },
  { broker: "Vantage", servers: ["VantageInternational-Demo", "VantageInternational-Live"] },
  { broker: "ThinkMarkets", servers: ["ThinkMarkets-Demo", "ThinkMarkets-Live"] },
  { broker: "FBS", servers: ["FBS-Demo", "FBS-Real"] },
  { broker: "RoboForex", servers: ["RoboForex-Demo", "RoboForex-Pro", "RoboForex-ECN"] },
];

export const STARTER_SERVERS: ServerOption[] = BROKERS.flatMap((b) => b.servers.map((server) => ({ server, broker: b.broker })));

/** Lower-case and drop spaces, dashes and underscores, so "ic markets live 1" can find "ICMarketsSC-Live01". */
const key = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/**
 * Servers matching what has been typed, best first: your own servers, then names that start with it, then names that
 * contain it, then brokers whose name contains it. Works from the first letter; a typed name that is not in the list is
 * still accepted by the form.
 */
export function suggestServers(query: string, mine: string[] = [], limit = 8): ServerOption[] {
  const q = key(query);
  const all: (ServerOption & { own: boolean })[] = [...mine.map((server) => ({ server, broker: "Your server", own: true })), ...STARTER_SERVERS.filter((s) => !mine.includes(s.server)).map((s) => ({ ...s, own: false }))];
  if (!q) return all.slice(0, limit).map(({ server, broker }) => ({ server, broker }));
  const rank = (s: ServerOption & { own: boolean }) => {
    const name = key(s.server);
    if (name.startsWith(q)) return s.own ? 0 : 1;
    if (name.includes(q)) return s.own ? 2 : 3;
    if (key(s.broker).includes(q)) return 4;
    return -1;
  };
  return all
    .map((s, i) => ({ s, r: rank(s), i }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(({ s }) => ({ server: s.server, broker: s.broker }));
}

/** Broker name for a known server, or null. */
export function brokerFor(server: string): string | null {
  const k = key(server);
  return STARTER_SERVERS.find((s) => key(s.server) === k)?.broker ?? null;
}

/** What may be stored as a server name: letters, digits, spaces and . _ - ( ), up to 80 characters. */
export const SERVER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,79}$/;
