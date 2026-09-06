CREATE TYPE "RightsReportFormat" AS ENUM ('STANDARD_USAGE_V1', 'SUMMARY_USAGE_V1');

CREATE TABLE "RightsReportingAuthority" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "code" VARCHAR(24) NOT NULL,
  "name" TEXT NOT NULL,
  "territoryCode" VARCHAR(2) NOT NULL,
  "reportFormat" "RightsReportFormat" NOT NULL DEFAULT 'STANDARD_USAGE_V1',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RightsReportingAuthority_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RightsReportingAuthority_code_check" CHECK ("code" ~ '^[A-Z0-9_-]{2,24}$'),
  CONSTRAINT "RightsReportingAuthority_territory_check" CHECK ("territoryCode" ~ '^[A-Z]{2}$')
);

CREATE TABLE "RightsWorkMapping" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "authorityId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "recordingCode" TEXT,
  "workCode" TEXT,
  "title" TEXT NOT NULL,
  "primaryArtist" TEXT NOT NULL,
  "composers" JSONB NOT NULL,
  "publishers" JSONB NOT NULL,
  "authorityReference" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByUserId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RightsWorkMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RightsWorkMapping_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "RightsUsageLedgerEvent" (
  "id" TEXT NOT NULL,
  "sourceProofEventId" TEXT NOT NULL,
  "sourceClientEventId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "stationId" TEXT,
  "channelId" TEXT,
  "trackId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "territoryCode" VARCHAR(2) NOT NULL,
  "rightsUse" "MusicRightsUse" NOT NULL DEFAULT 'ONLINE_RADIO',
  "trackTitle" TEXT NOT NULL,
  "trackArtist" TEXT NOT NULL,
  "rightsHolder" TEXT,
  "rightsReference" TEXT,
  "rightsBasis" "MusicRightsBasis",
  "evidenceSha256" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RightsUsageLedgerEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RightsUsageLedgerEvent_duration_check" CHECK ("durationSeconds" BETWEEN 0 AND 86400),
  CONSTRAINT "RightsUsageLedgerEvent_territory_check" CHECK ("territoryCode" ~ '^[A-Z]{2}$')
);

CREATE TABLE "RightsReportAttestation" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "authorityId" TEXT NOT NULL,
  "reportExportJobId" TEXT NOT NULL,
  "attestedByUserId" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "periodFrom" DATE NOT NULL,
  "periodTo" DATE NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "contentSha256" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RightsReportAttestation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RightsReportAttestation_row_count_check" CHECK ("rowCount" >= 0)
);

CREATE UNIQUE INDEX "RightsReportingAuthority_organisationId_code_key" ON "RightsReportingAuthority"("organisationId", "code");
CREATE UNIQUE INDEX "RightsReportingAuthority_id_organisationId_key" ON "RightsReportingAuthority"("id", "organisationId");
CREATE INDEX "RightsReportingAuthority_organisationId_active_name_idx" ON "RightsReportingAuthority"("organisationId", "active", "name");
CREATE UNIQUE INDEX "RightsWorkMapping_authorityId_trackId_key" ON "RightsWorkMapping"("authorityId", "trackId");
CREATE INDEX "RightsWorkMapping_organisationId_trackId_idx" ON "RightsWorkMapping"("organisationId", "trackId");
CREATE INDEX "RightsWorkMapping_authorityId_verifiedAt_idx" ON "RightsWorkMapping"("authorityId", "verifiedAt");
CREATE UNIQUE INDEX "RightsUsageLedgerEvent_sourceProofEventId_key" ON "RightsUsageLedgerEvent"("sourceProofEventId");
CREATE UNIQUE INDEX "RightsUsageLedgerEvent_sourceClientEventId_key" ON "RightsUsageLedgerEvent"("sourceClientEventId");
CREATE UNIQUE INDEX "RightsUsageLedgerEvent_evidenceSha256_key" ON "RightsUsageLedgerEvent"("evidenceSha256");
CREATE INDEX "RightsUsageLedgerEvent_organisationId_occurredAt_idx" ON "RightsUsageLedgerEvent"("organisationId", "occurredAt");
CREATE INDEX "RightsUsageLedgerEvent_trackId_occurredAt_idx" ON "RightsUsageLedgerEvent"("trackId", "occurredAt");
CREATE INDEX "RightsUsageLedgerEvent_stationId_occurredAt_idx" ON "RightsUsageLedgerEvent"("stationId", "occurredAt");
CREATE INDEX "RightsUsageLedgerEvent_channelId_occurredAt_idx" ON "RightsUsageLedgerEvent"("channelId", "occurredAt");
CREATE INDEX "RightsUsageLedgerEvent_territoryCode_occurredAt_idx" ON "RightsUsageLedgerEvent"("territoryCode", "occurredAt");
CREATE UNIQUE INDEX "RightsReportAttestation_reportExportJobId_key" ON "RightsReportAttestation"("reportExportJobId");
CREATE INDEX "RightsReportAttestation_organisationId_createdAt_idx" ON "RightsReportAttestation"("organisationId", "createdAt");
CREATE INDEX "RightsReportAttestation_authorityId_periodFrom_periodTo_idx" ON "RightsReportAttestation"("authorityId", "periodFrom", "periodTo");

ALTER TABLE "RightsReportingAuthority" ADD CONSTRAINT "RightsReportingAuthority_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RightsWorkMapping" ADD CONSTRAINT "RightsWorkMapping_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RightsWorkMapping" ADD CONSTRAINT "RightsWorkMapping_authority_org_fkey" FOREIGN KEY ("authorityId", "organisationId") REFERENCES "RightsReportingAuthority"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RightsWorkMapping" ADD CONSTRAINT "RightsWorkMapping_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsUsageLedgerEvent" ADD CONSTRAINT "RightsUsageLedgerEvent_sourceProofEventId_fkey" FOREIGN KEY ("sourceProofEventId") REFERENCES "ProofOfPlayEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsUsageLedgerEvent" ADD CONSTRAINT "RightsUsageLedgerEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsUsageLedgerEvent" ADD CONSTRAINT "RightsUsageLedgerEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsUsageLedgerEvent" ADD CONSTRAINT "RightsUsageLedgerEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsUsageLedgerEvent" ADD CONSTRAINT "RightsUsageLedgerEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsUsageLedgerEvent" ADD CONSTRAINT "RightsUsageLedgerEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsReportAttestation" ADD CONSTRAINT "RightsReportAttestation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsReportAttestation" ADD CONSTRAINT "RightsReportAttestation_authority_org_fkey" FOREIGN KEY ("authorityId", "organisationId") REFERENCES "RightsReportingAuthority"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RightsReportAttestation" ADD CONSTRAINT "RightsReportAttestation_reportExportJobId_fkey" FOREIGN KEY ("reportExportJobId") REFERENCES "ReportExportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "ruvanas_prevent_rights_evidence_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rights usage and attestation evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RightsUsageLedgerEvent_immutable" BEFORE UPDATE OR DELETE ON "RightsUsageLedgerEvent" FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_rights_evidence_mutation"();
CREATE TRIGGER "RightsReportAttestation_immutable" BEFORE UPDATE OR DELETE ON "RightsReportAttestation" FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_rights_evidence_mutation"();
