import { Prisma } from "@prisma/client";
import { resolveRange } from "./range";
import { SESSION_HOURS, type Filters } from "./params";

/** Open time as a wall-clock timestamp in the display timezone. */
export const localOpen = (tz: string) => Prisma.sql`((t."openedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;

/**
 * SQL WHERE clause (alias `t` on "Trade") for a set of filters. Every user-controlled value is bound as a
 * parameter, and every enum-like value has already been whitelisted by parseFilters.
 */
/** The individual conditions (alias `t`), for queries that join Trade instead of filtering it directly. */
export function tradeConditions(f: Filters, ctx: { tz: string; now?: Date }): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];

  if (f.status === "closed") c.push(Prisma.sql`t."status" = 'CLOSED'`);
  else if (f.status === "open") c.push(Prisma.sql`t."status" = 'OPEN'`);

  if (f.account) c.push(Prisma.sql`t."accountId" = ${f.account}`);

  const { from, to } = resolveRange(f.range, { from: f.from, to: f.to }, ctx.now, ctx.tz);
  if (from) c.push(Prisma.sql`COALESCE(t."closeDay", t."openDay") >= ${from}::date`);
  if (to) c.push(Prisma.sql`COALESCE(t."closeDay", t."openDay") <= ${to}::date`);

  if (f.instrument) c.push(Prisma.sql`t."instrumentType" = ${f.instrument}::"InstrumentType"`);
  if (f.duration) c.push(Prisma.sql`t."intraday" = ${f.duration === "intraday"}`);
  if (f.reviewed) c.push(Prisma.sql`t."reviewed" = ${f.reviewed === "yes"}`);
  if (f.side) c.push(Prisma.sql`t."side" = ${f.side}::"Side"`);
  if (f.symbol) c.push(Prisma.sql`t."symbol" = ${f.symbol}`);
  if (f.result) c.push(Prisma.sql`t."result" = ${f.result}::"TradeResult"`);

  if (f.tags.length) c.push(Prisma.sql`EXISTS (SELECT 1 FROM "TradeTag" tt WHERE tt."tradeId" = t."id" AND tt."tagId" IN (${Prisma.join(f.tags)}))`);

  if (f.strategy.length) {
    const ids = f.strategy.filter((s) => s !== "none");
    const parts: Prisma.Sql[] = [];
    if (ids.length) parts.push(Prisma.sql`t."strategyId" IN (${Prisma.join(ids)})`);
    if (f.strategy.includes("none")) parts.push(Prisma.sql`t."strategyId" IS NULL`);
    c.push(Prisma.sql`(${Prisma.join(parts, " OR ")})`);
  }

  if (f.dow.length) c.push(Prisma.sql`EXTRACT(DOW FROM ${localOpen(ctx.tz)})::int IN (${Prisma.join(f.dow)})`);
  if (f.hour.length) c.push(Prisma.sql`EXTRACT(HOUR FROM ${localOpen(ctx.tz)})::int IN (${Prisma.join(f.hour)})`);
  if (f.session.length) {
    const ranges = f.session.map((s) => {
      const [a, b] = SESSION_HOURS[s];
      return Prisma.sql`(EXTRACT(HOUR FROM t."openedAt")::int >= ${a} AND EXTRACT(HOUR FROM t."openedAt")::int < ${b})`;
    });
    c.push(Prisma.sql`(${Prisma.join(ranges, " OR ")})`);
  }

  for (const flag of f.flags) {
    switch (flag) {
      case "noStopLoss":
        c.push(Prisma.sql`t."stopLoss" IS NULL`);
        break;
      case "noTarget":
        c.push(Prisma.sql`t."profitTarget" IS NULL`);
        break;
      case "noStrategy":
        c.push(Prisma.sql`t."strategyId" IS NULL`);
        break;
      case "untagged":
        c.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "TradeTag" tt WHERE tt."tradeId" = t."id")`);
        break;
      case "unreviewed":
        c.push(Prisma.sql`t."reviewed" = false`);
        break;
      case "hasMistake":
        c.push(
          Prisma.sql`EXISTS (SELECT 1 FROM "TradeTag" tt JOIN "Tag" g ON g."id" = tt."tagId" JOIN "TagCategory" tc ON tc."id" = g."categoryId" WHERE tt."tradeId" = t."id" AND tc."name" = 'Mistakes')`,
        );
        break;
    }
  }

  return c;
}

export function tradeWhere(f: Filters, ctx: { tz: string; now?: Date }): Prisma.Sql {
  const c = tradeConditions(f, ctx);
  return c.length ? Prisma.sql`WHERE ${Prisma.join(c, " AND ")}` : Prisma.sql`WHERE TRUE`;
}
