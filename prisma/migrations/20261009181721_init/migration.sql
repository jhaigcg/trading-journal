-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('MT4', 'MT5', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('MANUAL', 'FILE_IMPORT', 'AUTO_METAAPI');

-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('FOREX_CFD', 'FUTURES', 'STOCK');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TradeResult" AS ENUM ('WIN', 'LOSS', 'BREAKEVEN');

-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('TRADE', 'DAILY', 'SESSION_RECAP', 'FREE');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('TIME_BY', 'PERCENT_WITH_FIELD', 'MAX_LOSS_PER_TRADE', 'MAX_LOSS_PER_DAY', 'MANUAL_CHECK');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('MT4_HTML', 'MT4_CSV', 'MT5_HTML', 'GENERIC_CSV', 'METAAPI', 'MANUAL');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "displayTimezone" TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
    "displayCurrency" TEXT NOT NULL DEFAULT 'AUD',
    "breakevenThreshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tradingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "brokerUtcOffsetMin" INTEGER NOT NULL DEFAULT 120,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("base","quote")
);

-- CreateTable
CREATE TABLE "SymbolConfig" (
    "symbol" TEXT NOT NULL,
    "instrumentType" "InstrumentType" NOT NULL DEFAULT 'FOREX_CFD',
    "pipSize" DECIMAL(18,8) NOT NULL DEFAULT 0.01,
    "contractSize" DECIMAL(18,4) NOT NULL DEFAULT 100,
    "aliases" TEXT[],

    CONSTRAINT "SymbolConfig_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "broker" TEXT,
    "platform" "Platform" NOT NULL DEFAULT 'MT4',
    "mtLogin" TEXT,
    "mtServer" TEXT,
    "metaapiAccountId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "startingBalance" DECIMAL(18,2) NOT NULL,
    "brokerUtcOffsetMin" INTEGER,
    "syncType" "SyncType" NOT NULL DEFAULT 'AUTO_METAAPI',
    "syncOnLogin" BOOLEAN NOT NULL DEFAULT true,
    "syncCursor" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastBalance" DECIMAL(18,2),
    "lastEquity" DECIMAL(18,2),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'RUNNING',
    "filename" TEXT,
    "tradesNew" INTEGER NOT NULL DEFAULT 0,
    "tradesUpd" INTEGER NOT NULL DEFAULT 0,
    "tradesSkip" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportMapping" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,

    CONSTRAINT "ImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "brokerTicket" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "comment" TEXT,

    CONSTRAINT "BalanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "brokerTicket" TEXT,
    "symbol" TEXT NOT NULL,
    "instrumentType" "InstrumentType" NOT NULL DEFAULT 'FOREX_CFD',
    "side" "Side" NOT NULL,
    "status" "TradeStatus" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "holdSeconds" INTEGER,
    "intraday" BOOLEAN NOT NULL DEFAULT true,
    "openDay" DATE NOT NULL,
    "closeDay" DATE,
    "quantity" DECIMAL(18,4) NOT NULL,
    "avgEntry" DECIMAL(18,5) NOT NULL,
    "avgExit" DECIMAL(18,5),
    "grossPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "swap" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fees" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netRoi" DECIMAL(12,4),
    "pips" DECIMAL(14,2),
    "returnPerPip" DECIMAL(14,4),
    "adjustedCost" DECIMAL(18,2),
    "result" "TradeResult",
    "stopLoss" DECIMAL(18,5),
    "profitTarget" DECIMAL(18,5),
    "initialTarget" DECIMAL(18,5),
    "maePrice" DECIMAL(18,5),
    "mfePrice" DECIMAL(18,5),
    "tradeRisk" DECIMAL(18,2),
    "plannedR" DECIMAL(10,3),
    "realizedR" DECIMAL(10,3),
    "rating" DECIMAL(2,1),
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "mtComment" TEXT,
    "magicNumber" INTEGER,
    "shareToken" TEXT,
    "strategyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "brokerTicket" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(18,5) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "grossPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "swap" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "color" TEXT NOT NULL DEFAULT '#E0B04E',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleGroup" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RuleGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyRule" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StrategyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeRuleCheck" (
    "tradeId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "followed" BOOLEAN NOT NULL,

    CONSTRAINT "TradeRuleCheck_pkey" PRIMARY KEY ("tradeId","ruleId")
);

-- CreateTable
CREATE TABLE "MissedTrade" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "symbol" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "side" "Side",
    "hypotheticalR" DECIMAL(10,3),
    "reason" TEXT,
    "screenshotUrl" TEXT,

    CONSTRAINT "MissedTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TagCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeTag" (
    "tradeId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TradeTag_pkey" PRIMARY KEY ("tradeId","tagId")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT,
    "noteId" TEXT,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NoteFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "NoteKind" NOT NULL DEFAULT 'TRADE',
    "content" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "kind" "NoteKind" NOT NULL DEFAULT 'FREE',
    "title" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL,
    "plainText" TEXT NOT NULL DEFAULT '',
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "folderId" TEXT,
    "tradeId" TEXT,
    "strategyId" TEXT,
    "day" DATE,
    "startedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteTag" (
    "noteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "NoteTag_pkey" PRIMARY KEY ("noteId","tagId")
);

-- CreateTable
CREATE TABLE "DisciplineRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "params" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DisciplineRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplineLog" (
    "ruleId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "followed" BOOLEAN NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DisciplineLog_pkey" PRIMARY KEY ("ruleId","day")
);

-- CreateTable
CREATE TABLE "DailySummary" (
    "accountId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "trades" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "breakevens" INTEGER NOT NULL,
    "grossPnl" DECIMAL(18,2) NOT NULL,
    "commission" DECIMAL(18,2) NOT NULL,
    "swap" DECIMAL(18,2) NOT NULL,
    "netPnl" DECIMAL(18,2) NOT NULL,
    "volume" DECIMAL(18,4) NOT NULL,
    "grossWin" DECIMAL(18,2) NOT NULL,
    "grossLoss" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "DailySummary_pkey" PRIMARY KEY ("accountId","day")
);

-- CreateTable
CREATE TABLE "Candle" (
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "t" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(18,5) NOT NULL,
    "high" DECIMAL(18,5) NOT NULL,
    "low" DECIMAL(18,5) NOT NULL,
    "close" DECIMAL(18,5) NOT NULL,
    "volume" DECIMAL(18,2),

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("symbol","timeframe","t")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_platform_mtLogin_key" ON "Account"("platform", "mtLogin");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMapping_name_key" ON "ImportMapping"("name");

-- CreateIndex
CREATE INDEX "BalanceEvent_accountId_at_idx" ON "BalanceEvent"("accountId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceEvent_accountId_brokerTicket_key" ON "BalanceEvent"("accountId", "brokerTicket");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_shareToken_key" ON "Trade"("shareToken");

-- CreateIndex
CREATE INDEX "Trade_accountId_closedAt_idx" ON "Trade"("accountId", "closedAt");

-- CreateIndex
CREATE INDEX "Trade_accountId_openDay_idx" ON "Trade"("accountId", "openDay");

-- CreateIndex
CREATE INDEX "Trade_symbol_idx" ON "Trade"("symbol");

-- CreateIndex
CREATE INDEX "Trade_strategyId_idx" ON "Trade"("strategyId");

-- CreateIndex
CREATE INDEX "Trade_status_reviewed_idx" ON "Trade"("status", "reviewed");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_accountId_brokerTicket_key" ON "Trade"("accountId", "brokerTicket");

-- CreateIndex
CREATE INDEX "Execution_tradeId_at_idx" ON "Execution"("tradeId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_tradeId_brokerTicket_key" ON "Execution"("tradeId", "brokerTicket");

-- CreateIndex
CREATE UNIQUE INDEX "TagCategory_name_key" ON "TagCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_categoryId_name_key" ON "Tag"("categoryId", "name");

-- CreateIndex
CREATE INDEX "TradeTag_tagId_idx" ON "TradeTag"("tagId");

-- CreateIndex
CREATE INDEX "Note_kind_day_idx" ON "Note"("kind", "day");

-- CreateIndex
CREATE INDEX "Note_tradeId_idx" ON "Note"("tradeId");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEvent" ADD CONSTRAINT "BalanceEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleGroup" ADD CONSTRAINT "RuleGroup_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyRule" ADD CONSTRAINT "StrategyRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RuleGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeRuleCheck" ADD CONSTRAINT "TradeRuleCheck_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeRuleCheck" ADD CONSTRAINT "TradeRuleCheck_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "StrategyRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedTrade" ADD CONSTRAINT "MissedTrade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TagCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTag" ADD CONSTRAINT "TradeTag_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTag" ADD CONSTRAINT "TradeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "NoteFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineLog" ADD CONSTRAINT "DisciplineLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DisciplineRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
