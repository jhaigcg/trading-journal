-- CreateTable
CREATE TABLE "CandleCoverage" (
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CandleCoverage_pkey" PRIMARY KEY ("symbol","timeframe","period")
);

