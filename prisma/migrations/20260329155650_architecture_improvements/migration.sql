-- AlterTable
ALTER TABLE "brain_dump_history" ADD COLUMN     "rawTextHash" TEXT;

-- CreateTable
CREATE TABLE "llm_call_log" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_call_log_task_idx" ON "llm_call_log"("task");

-- CreateIndex
CREATE INDEX "llm_call_log_createdAt_idx" ON "llm_call_log"("createdAt");

-- CreateIndex
CREATE INDEX "brain_dump_history_rawTextHash_createdAt_idx" ON "brain_dump_history"("rawTextHash", "createdAt");
