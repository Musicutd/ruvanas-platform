ALTER TABLE "CorrectionsEdgeNode" ADD COLUMN "proofPublicKeyPem" TEXT;
ALTER TABLE "CorrectionsEdgeNode" ADD COLUMN "lastProofSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CorrectionsEdgeNode" ADD COLUMN "lastProofHash" CHAR(64);

CREATE TABLE "CorrectionsEdgeProofEvent" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventId" TEXT NOT NULL,
  "previousHash" CHAR(64),
  "eventHash" CHAR(64) NOT NULL,
  "signature" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proofOfPlayEventId" TEXT,
  CONSTRAINT "CorrectionsEdgeProofEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorrectionsEdgeProofEvent_eventId_key" ON "CorrectionsEdgeProofEvent"("eventId");
CREATE UNIQUE INDEX "CorrectionsEdgeProofEvent_proofOfPlayEventId_key" ON "CorrectionsEdgeProofEvent"("proofOfPlayEventId");
CREATE UNIQUE INDEX "CorrectionsEdgeProofEvent_nodeId_sequence_key" ON "CorrectionsEdgeProofEvent"("nodeId", "sequence");
CREATE INDEX "CorrectionsEdgeProofEvent_nodeId_occurredAt_idx" ON "CorrectionsEdgeProofEvent"("nodeId", "occurredAt");
ALTER TABLE "CorrectionsEdgeProofEvent" ADD CONSTRAINT "CorrectionsEdgeProofEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CorrectionsEdgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
