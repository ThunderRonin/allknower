-- CreateTable
CREATE TABLE "brain_dump_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "parentNoteId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "resultHistoryId" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "brain_dump_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brain_dump_jobs_status_createdAt_idx" ON "brain_dump_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "brain_dump_jobs_userId_batchId_idx" ON "brain_dump_jobs"("userId", "batchId");

-- CreateIndex
CREATE INDEX "brain_dump_jobs_batchId_idx" ON "brain_dump_jobs"("batchId");
