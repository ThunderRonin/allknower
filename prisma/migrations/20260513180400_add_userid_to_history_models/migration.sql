-- AlterTable
ALTER TABLE "brain_dump_history" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "llm_call_log" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "lore_sessions" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "relation_history" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "brain_dump_history_userId_idx" ON "brain_dump_history"("userId");

-- CreateIndex
CREATE INDEX "llm_call_log_userId_idx" ON "llm_call_log"("userId");

-- CreateIndex
CREATE INDEX "lore_sessions_userId_idx" ON "lore_sessions"("userId");

-- CreateIndex
CREATE INDEX "relation_history_userId_idx" ON "relation_history"("userId");
