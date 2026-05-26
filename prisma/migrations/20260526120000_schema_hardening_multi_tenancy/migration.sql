-- Schema hardening: multi-tenancy + referential integrity

-- 1. RelationSuggestion: remove @default("") from userId
-- Existing rows already have userId populated (non-empty) from application code
ALTER TABLE "relation_suggestions" ALTER COLUMN "userId" DROP DEFAULT;

-- 2. PushSubscription: change unique constraint from endpoint-only to (endpoint, userId)
-- This prevents cross-user subscription takeover
DROP INDEX IF EXISTS "push_subscriptions_endpoint_key";
CREATE UNIQUE INDEX "push_subscriptions_endpoint_userId_key" ON "push_subscriptions"("endpoint", "userId");

-- 3. BrainDumpRevisionLink: add userId column
-- Backfill existing rows from their parent BrainDumpHistory record
ALTER TABLE "brain_dump_revision_links" ADD COLUMN "userId" TEXT;

UPDATE "brain_dump_revision_links" SET "userId" = COALESCE(
    (SELECT "userId" FROM "brain_dump_history" WHERE "brain_dump_history"."id" = "brain_dump_revision_links"."brainDumpHistoryId"),
    ''
) WHERE "userId" IS NULL;

ALTER TABLE "brain_dump_revision_links" ALTER COLUMN "userId" SET NOT NULL;
CREATE INDEX "brain_dump_revision_links_userId_idx" ON "brain_dump_revision_links"("userId");
