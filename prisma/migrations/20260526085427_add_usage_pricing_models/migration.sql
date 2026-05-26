-- AlterTable
ALTER TABLE "llm_call_log" ADD COLUMN     "costUsd" DECIMAL(12,8),
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER;

-- CreateTable
CREATE TABLE "model_pricing" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "pricePerMInput" DECIMAL(14,8) NOT NULL,
    "pricePerMOutput" DECIMAL(14,8) NOT NULL,
    "lastFetched" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_budgets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyBudgetUsd" DECIMAL(10,4),
    "monthlyBudgetUsd" DECIMAL(10,4),
    "alertEmail" TEXT,
    "digestLastSentDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_pricing_modelId_key" ON "model_pricing"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "user_budgets_userId_key" ON "user_budgets"("userId");

-- CreateIndex
CREATE INDEX "llm_call_log_userId_createdAt_idx" ON "llm_call_log"("userId", "createdAt");
