-- CreateTable
CREATE TABLE "user_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "tokenLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_integrations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "relation_history" ADD COLUMN "relationName" TEXT;

-- CreateIndex
CREATE INDEX "user_integrations_provider_idx" ON "user_integrations"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_integrations_userId_provider_key" ON "user_integrations"("userId", "provider");

-- AddForeignKey
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
