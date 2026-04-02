-- CreateTable
CREATE TABLE "lore_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "state" JSONB NOT NULL,
    "tokensAccumulated" INTEGER NOT NULL DEFAULT 0,
    "compactionCount" INTEGER NOT NULL DEFAULT 0,
    "compactionFailed" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lore_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lore_session_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lore_session_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lore_session_messages_sessionId_createdAt_idx" ON "lore_session_messages"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "lore_session_messages" ADD CONSTRAINT "lore_session_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "lore_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
