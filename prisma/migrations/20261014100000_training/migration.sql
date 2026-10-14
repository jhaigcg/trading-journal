-- CreateEnum
CREATE TYPE "ScenarioKind" AS ENUM ('SETUP', 'EVENT');

-- CreateTable
CREATE TABLE "TrainingScenario" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "kind" "ScenarioKind" NOT NULL DEFAULT 'SETUP',
    "decisionAt" TIMESTAMP(3) NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT 'M5',
    "horizonMinutes" INTEGER NOT NULL DEFAULT 240,
    "lookbackHours" INTEGER NOT NULL DEFAULT 24,
    "side" "Side",
    "entryLow" DECIMAL(18,5),
    "entryHigh" DECIMAL(18,5),
    "stopLoss" DECIMAL(18,5),
    "takeProfit" DECIMAL(18,5),
    "notes" TEXT,
    "imageKey" TEXT,
    "strategyId" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAttempt" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "side" "Side" NOT NULL,
    "entryAt" TIMESTAMP(3),
    "entry" DECIMAL(18,5) NOT NULL,
    "stopLoss" DECIMAL(18,5) NOT NULL,
    "takeProfit" DECIMAL(18,5) NOT NULL,
    "filled" BOOLEAN NOT NULL,
    "outcome" TEXT NOT NULL,
    "exitPrice" DECIMAL(18,5),
    "rMultiple" DECIMAL(10,3),
    "matchScore" INTEGER,
    "details" JSONB,
    "repeat" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TrainingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingScenario_archived_createdAt_idx" ON "TrainingScenario"("archived", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingAttempt_scenarioId_createdAt_idx" ON "TrainingAttempt"("scenarioId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrainingScenario" ADD CONSTRAINT "TrainingScenario_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "TrainingScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

