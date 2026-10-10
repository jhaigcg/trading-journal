/**
 * Seed: single user, settings, symbol config, tag categories, SMC strategy templates,
 * discipline rules, note templates, and ~500 realistic XAUUSD scalping trades (deterministic).
 *
 *   SEED_EMAIL / SEED_PASSWORD come from .env. Re-running is safe: demo trades are replaced.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { holdSeconds, netRoi, pips, plannedR, realizedR, riskAmount, round2, classify } from "../src/lib/metrics";
import { dayKey } from "../src/lib/time";
import { PLAYBOOK_TEMPLATES } from "../src/lib/playbooks/templates";

const db = new PrismaClient();
const TZ = "Asia/Hong_Kong";
const DEMO_ACCOUNT = "MT4 · Main account (demo data)";
const FX_USD_TO_AUD = 1.52;

// ── deterministic PRNG so every seed run produces the same journal ──
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261010);
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

const TAGS: Record<string, string[]> = {
  "SMC setups": ["Order block", "FVG", "CHoCH", "BOS", "Liquidity sweep", "Premium/Discount", "Breaker block", "Inducement"],
  Mistakes: ["Moved stop loss", "Entered early", "Oversized", "Revenge trade", "No confirmation", "Closed too early"],
  "Confidence level": ["High", "Medium", "Low"],
  Distractions: ["Phone", "Social media", "Family", "Noise"],
  "Mental state": ["Calm", "Focused", "Anxious", "Tired", "FOMO", "Overconfident"],
  Sleep: ["< 5h", "5–7h", "7h+"],
  "Pre-market routine": ["Bias set", "Levels marked", "News checked", "Skipped routine"],
  "Entry off": ["Wrong session", "Against HTF bias", "No setup", "Chased price"],
  "News on this day": ["NFP", "CPI", "FOMC", "PMI", "No major news"],
};

// the demo journal starts with the first three starter playbooks
const STRATEGIES = PLAYBOOK_TEMPLATES.slice(0, 3);

async function main() {
  const email = (process.env.SEED_EMAIL ?? "").toLowerCase();
  const password = process.env.SEED_PASSWORD ?? "";
  if (!email || password.length < 10) throw new Error("Set SEED_EMAIL and SEED_PASSWORD (10+ chars) in .env before seeding.");

  await db.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 12) },
    create: { email, passwordHash: await bcrypt.hash(password, 12) },
  });

  await db.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1, displayTimezone: TZ } });
  await db.fxRate.upsert({
    where: { base_quote: { base: "USD", quote: "AUD" } },
    update: { rate: 1 / 0.658 },
    create: { base: "USD", quote: "AUD", rate: 1 / 0.658 },
  });

  const xau = await db.symbolConfig.upsert({
    where: { symbol: "XAUUSD" },
    update: {},
    create: { symbol: "XAUUSD", pipSize: 0.01, contractSize: 100, aliases: ["XAUUSD.a", "XAUUSDm", "GOLD"] },
  });
  await db.symbolConfig.upsert({
    where: { symbol: "COTTON" },
    update: {},
    create: { symbol: "COTTON", instrumentType: "FUTURES", pipSize: 0.01, contractSize: 50000, aliases: ["CT", "COTTON#2"] },
  });

  // ── tags ──
  const tagIds: Record<string, Record<string, string>> = {};
  let pos = 0;
  for (const [cat, names] of Object.entries(TAGS)) {
    const c = await db.tagCategory.upsert({ where: { name: cat }, update: {}, create: { name: cat, position: pos++ } });
    tagIds[cat] = {};
    for (const n of names) {
      const t = await db.tag.upsert({ where: { categoryId_name: { categoryId: c.id, name: n } }, update: {}, create: { categoryId: c.id, name: n } });
      tagIds[cat][n] = t.id;
    }
  }

  // ── strategies ──
  const strategyIds: string[] = [];
  for (const s of STRATEGIES) {
    let st = await db.strategy.findFirst({ where: { name: s.name } });
    if (!st) {
      st = await db.strategy.create({
        data: {
          name: s.name,
          color: s.color,
          description: s.description,
          groups: {
            create: s.groups.map((g, gi) => ({
              name: g.name,
              position: gi,
              rules: { create: g.rules.map((text, ri) => ({ text, position: ri })) },
            })),
          },
        },
      });
    }
    strategyIds.push(st.id);
  }

  // ── discipline rules & note templates (only when empty) ──
  if ((await db.disciplineRule.count()) === 0) {
    await db.disciplineRule.createMany({
      data: [
        { name: "Start my day by 09:30", kind: "TIME_BY", params: { time: "09:30" }, position: 0 },
        { name: "Link trades to a playbook", kind: "PERCENT_WITH_FIELD", params: { field: "strategyId", target: 100 }, position: 1 },
        { name: "Stop loss on all trades", kind: "PERCENT_WITH_FIELD", params: { field: "stopLoss", target: 100 }, position: 2 },
        { name: "Max net loss per trade A$100", kind: "MAX_LOSS_PER_TRADE", params: { amount: 100 }, position: 3 },
        { name: "Max net loss per day A$100", kind: "MAX_LOSS_PER_DAY", params: { amount: 100 }, position: 4 },
      ],
    });
  }
  if ((await db.noteTemplate.count()) === 0) {
    const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const heading = (text: string) => ({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] });
    await db.noteTemplate.create({
      data: {
        name: "Trade review",
        kind: "TRADE",
        isDefault: true,
        content: {
          type: "doc",
          content: [
            heading("Why did you take this trade?"), para(""),
            heading("Did you follow your rules?"), para(""),
            heading("Emotions, chart patterns, trade-management lessons"), para(""),
          ],
        },
      },
    });
  }

  // production: SEED_DEMO=0 creates only the login, settings, tags and starter playbooks, never fake trades
  if (process.env.SEED_DEMO === "0") {
    console.log(`Created your login (${email}), settings, tags and starter playbooks. No demo trades (SEED_DEMO=0).`);
    return;
  }

  // ── demo account + trades ──
  await db.account.deleteMany({ where: { name: DEMO_ACCOUNT } });
  const account = await db.account.create({
    data: {
      name: DEMO_ACCOUNT,
      broker: "Demo broker",
      platform: "MT4",
      mtLogin: "demo-0000",
      currency: "AUD",
      startingBalance: 10000,
      syncType: "MANUAL",
      lastSyncAt: new Date(),
    },
  });

  const winTags = ["Order block", "FVG", "CHoCH", "BOS", "Liquidity sweep"];
  let price = 4200;
  let ticket = 5_000_000;
  const trades: Prisma.TradeCreateManyInput[] = [];
  const execs: Prisma.ExecutionCreateManyInput[] = [];
  const tradeTags: { tradeId: string; tagId: string }[] = [];

  // last ~34 weekdays ending on the most recent weekday
  const days: Date[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (days.length < 34) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.unshift(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const TARGET = 500;
  const perDay = days.map(() => Math.round(between(10, 20)));
  const scale = TARGET / perDay.reduce((a, b) => a + b, 0);
  const counts = perDay.map((n) => Math.max(4, Math.round(n * scale)));

  const cuid = () => `seed${(ticket++).toString(36)}${Math.floor(rnd() * 1e9).toString(36)}`;

  days.forEach((day, di) => {
    // a trending-ish day bias: some days are good, some bad
    const dayEdge = between(-0.12, 0.16);
    let t = day.getTime() + 7 * 3600_000 + between(0, 1800) * 1000; // start ~07:00 UTC (London)
    for (let k = 0; k < counts[di]; k++) {
      const side = chance(0.5) ? "LONG" : "SHORT";
      const lots = Math.round(between(5, 30)) / 100;
      price += between(-6, 6);
      const entry = round2(price);
      const isWin = chance(0.56 + dayEdge);
      const move = isWin ? between(1.2, 6.5) : between(1.0, 4.8); // price distance in USD per oz
      const exitPrice = round2(entry + (side === "LONG" ? 1 : -1) * (isWin ? move : -move));
      const hold = Math.round(isWin ? between(40, 1500) : between(25, 900));
      t += between(120, 1500) * 1000;
      const openedAt = new Date(t);
      const closedAt = new Date(t + hold * 1000);
      const partial = chance(0.25) && lots >= 0.1;

      const dirMove = (side === "LONG" ? 1 : -1) * (exitPrice - entry);
      const grossUsd = dirMove * lots * 100;
      const commissionUsd = -7 * lots;
      const gross = round2(grossUsd * FX_USD_TO_AUD);
      const commission = round2(commissionUsd * FX_USD_TO_AUD);
      const net = round2(gross + commission);

      const hasStop = chance(0.88);
      const stopDist = between(2.0, 4.5);
      const stopLoss = hasStop ? round2(entry + (side === "LONG" ? -1 : 1) * stopDist) : null;
      const hasTarget = chance(0.7);
      const target = hasTarget ? round2(entry + (side === "LONG" ? 1 : -1) * stopDist * between(1.5, 3)) : null;
      const riskUsd = riskAmount({ entry, stop: stopLoss, lots, contractSize: 100 });
      const risk = riskUsd == null ? null : round2(riskUsd * FX_USD_TO_AUD);
      const adjustedCost = round2(entry * lots * 100 * FX_USD_TO_AUD * 0.01); // ~1% margin proxy

      const id = cuid();
      const strategyId = chance(0.82) ? pick(strategyIds) : null;
      const open = di === days.length - 1 && k >= counts[di] - 2; // last two trades still open

      trades.push({
        id,
        accountId: account.id,
        brokerTicket: String(ticket),
        symbol: "XAUUSD",
        side,
        status: open ? "OPEN" : "CLOSED",
        openedAt,
        closedAt: open ? null : closedAt,
        holdSeconds: open ? null : holdSeconds(openedAt, closedAt),
        intraday: true,
        openDay: new Date(`${dayKey(openedAt, TZ)}T00:00:00Z`),
        closeDay: open ? null : new Date(`${dayKey(closedAt, TZ)}T00:00:00Z`),
        quantity: lots,
        avgEntry: entry,
        avgExit: open ? null : exitPrice,
        grossPnl: open ? 0 : gross,
        commission: open ? 0 : commission,
        netPnl: open ? 0 : net,
        netRoi: open ? null : round2(netRoi(net, adjustedCost) ?? 0),
        pips: open ? null : pips(entry, exitPrice, side, 0.01),
        adjustedCost,
        result: open ? null : ({ WIN: "WIN", LOSS: "LOSS", BE: "BREAKEVEN" } as const)[classify(net)],
        stopLoss,
        profitTarget: target,
        initialTarget: target,
        tradeRisk: risk,
        plannedR: plannedR(entry, stopLoss, target) == null ? null : round2(plannedR(entry, stopLoss, target)!),
        realizedR: open || realizedR(net, risk) == null ? null : round2(realizedR(net, risk)!),
        reviewed: !open && chance(0.35),
        rating: !open && chance(0.4) ? pick([2, 3, 3.5, 4, 4.5, 5]) : null,
        strategyId,
      });

      // executions: one entry, one or two exits (scale-out)
      execs.push({ tradeId: id, brokerTicket: `${ticket}-in`, at: openedAt, price: entry, quantity: lots });
      if (!open) {
        if (partial) {
          const half = round2(lots / 2);
          const midPrice = round2(entry + (exitPrice - entry) * between(0.3, 0.7));
          const g1 = round2((side === "LONG" ? 1 : -1) * (midPrice - entry) * half * 100 * FX_USD_TO_AUD);
          execs.push({ tradeId: id, brokerTicket: `${ticket}-out1`, at: new Date(openedAt.getTime() + (hold * 1000) / 2), price: midPrice, quantity: -half, grossPnl: g1 });
          execs.push({ tradeId: id, brokerTicket: `${ticket}-out2`, at: closedAt, price: exitPrice, quantity: -(lots - half), grossPnl: round2(gross - g1) });
        } else {
          execs.push({ tradeId: id, brokerTicket: `${ticket}-out`, at: closedAt, price: exitPrice, quantity: -lots, grossPnl: gross });
        }
      }

      // tags: SMC setup(s); mistakes on some losers
      for (const n of new Set([pick(winTags), ...(chance(0.3) ? [pick(winTags)] : [])])) tradeTags.push({ tradeId: id, tagId: tagIds["SMC setups"][n] });
      if (net < 0 && chance(0.35)) tradeTags.push({ tradeId: id, tagId: tagIds["Mistakes"][pick(Object.keys(tagIds["Mistakes"]))] });
      if (chance(0.3)) tradeTags.push({ tradeId: id, tagId: tagIds["Confidence level"][pick(TAGS["Confidence level"])] });
    }
  });

  await db.trade.createMany({ data: trades });
  await db.execution.createMany({ data: execs });
  await db.tradeTag.createMany({ data: tradeTags, skipDuplicates: true });

  // ── daily summary (materialised) ──
  const closed = trades.filter((t) => t.status === "CLOSED");
  const byDay = new Map<string, typeof closed>();
  for (const t of closed) {
    const k = (t.closeDay as Date).toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }
  await db.dailySummary.createMany({
    data: [...byDay.entries()].map(([k, ts]) => {
      const nets = ts.map((t) => Number(t.netPnl));
      return {
        accountId: account.id,
        day: new Date(`${k}T00:00:00Z`),
        trades: ts.length,
        wins: nets.filter((n) => n > 0).length,
        losses: nets.filter((n) => n < 0).length,
        breakevens: nets.filter((n) => n === 0).length,
        grossPnl: round2(ts.reduce((s, t) => s + Number(t.grossPnl), 0)),
        commission: round2(ts.reduce((s, t) => s + Number(t.commission), 0)),
        swap: 0,
        netPnl: round2(nets.reduce((a, b) => a + b, 0)),
        volume: round2(ts.reduce((s, t) => s + Number(t.quantity), 0)),
        grossWin: round2(nets.filter((n) => n > 0).reduce((a, b) => a + b, 0)),
        grossLoss: round2(nets.filter((n) => n < 0).reduce((a, b) => a + b, 0)),
      };
    }),
  });

  console.log(`Seeded ${trades.length} trades (${closed.length} closed), ${execs.length} executions, ${byDay.size} trading days.`);
  console.log(`Sign in as ${email} with SEED_PASSWORD from .env`);
  void xau;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
