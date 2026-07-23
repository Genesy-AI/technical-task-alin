-- CreateTable
CREATE TABLE "Enrichment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leadId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "workflowId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Enrichment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Enrichment_leadId_idx" ON "Enrichment"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrichment_leadId_type_key" ON "Enrichment"("leadId", "type");
