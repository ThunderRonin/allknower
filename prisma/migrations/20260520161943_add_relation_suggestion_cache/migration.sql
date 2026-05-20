-- CreateTable
CREATE TABLE "relation_suggestions" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relation_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "relation_suggestions_noteId_contentHash_idx" ON "relation_suggestions"("noteId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "relation_suggestions_noteId_userId_key" ON "relation_suggestions"("noteId", "userId");
