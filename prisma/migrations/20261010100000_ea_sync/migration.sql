-- AlterEnum
ALTER TYPE "ImportSource" ADD VALUE 'EA_PUSH';

-- AlterEnum
ALTER TYPE "SyncType" ADD VALUE 'AUTO_EA';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "brokerTimeMode" TEXT NOT NULL DEFAULT 'NYCLOSE',
ADD COLUMN     "ingestTokenHash" TEXT,
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "lastReportedOffsetMin" INTEGER;

-- CreateTable
CREATE TABLE "BrokerOrder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "openTime" TIMESTAMP(3) NOT NULL,
    "closeTime" TIMESTAMP(3),
    "openPrice" DECIMAL(18,5) NOT NULL,
    "closePrice" DECIMAL(18,5),
    "lots" DECIMAL(18,4) NOT NULL,
    "symbol" TEXT NOT NULL,
    "profit" DECIMAL(18,2) NOT NULL,
    "swap" DECIMAL(18,2) NOT NULL,
    "commission" DECIMAL(18,2) NOT NULL,
    "stopLoss" DECIMAL(18,5),
    "takeProfit" DECIMAL(18,5),
    "comment" TEXT,
    "refTicket" TEXT,
    "magic" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrokerOrder_accountId_refTicket_idx" ON "BrokerOrder"("accountId", "refTicket");

-- CreateIndex
CREATE INDEX "BrokerOrder_accountId_closeTime_idx" ON "BrokerOrder"("accountId", "closeTime");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerOrder_accountId_ticket_key" ON "BrokerOrder"("accountId", "ticket");

-- CreateIndex
CREATE UNIQUE INDEX "Account_ingestTokenHash_key" ON "Account"("ingestTokenHash");

-- AddForeignKey
ALTER TABLE "BrokerOrder" ADD CONSTRAINT "BrokerOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

