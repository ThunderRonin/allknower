-- CreateTable
CREATE TABLE "brain_dump_revision_links" (
    "id" TEXT NOT NULL,
    "brainDumpHistoryId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "revisionIdBefore" TEXT,
    "revisionIdAfter" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_dump_revision_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brain_dump_revision_links_brainDumpHistoryId_idx" ON "brain_dump_revision_links"("brainDumpHistoryId");

-- CreateIndex
CREATE INDEX "brain_dump_revision_links_noteId_idx" ON "brain_dump_revision_links"("noteId");
