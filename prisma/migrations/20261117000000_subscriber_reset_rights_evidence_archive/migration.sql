CREATE TABLE "RightsEvidenceResetArchive" (
  "sourceTable" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "tenantOrganisationId" TEXT NOT NULL,
  "archivedByUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'SUBSCRIBER_TEST_DATA_RESET',
  "payload" JSONB NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RightsEvidenceResetArchive_pkey" PRIMARY KEY ("sourceTable", "sourceId"),
  CONSTRAINT "RightsEvidenceResetArchive_sourceTable_check"
    CHECK ("sourceTable" IN ('RightsUsageLedgerEvent', 'RightsReportAttestation'))
);

CREATE INDEX "RightsEvidenceResetArchive_tenantOrganisationId_archivedAt_idx"
  ON "RightsEvidenceResetArchive"("tenantOrganisationId", "archivedAt");
CREATE INDEX "RightsEvidenceResetArchive_archivedByUserId_archivedAt_idx"
  ON "RightsEvidenceResetArchive"("archivedByUserId", "archivedAt");

CREATE OR REPLACE FUNCTION "ruvanas_prevent_rights_evidence_archive_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Archived rights evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RightsEvidenceResetArchive_immutable"
  BEFORE UPDATE OR DELETE ON "RightsEvidenceResetArchive"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_rights_evidence_archive_mutation"();

CREATE OR REPLACE FUNCTION "ruvanas_prevent_rights_evidence_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM "RightsEvidenceResetArchive" AS archive
    WHERE archive."sourceTable" = TG_TABLE_NAME
      AND archive."sourceId" = OLD.id
      AND archive."tenantOrganisationId" = OLD."organisationId"
      AND archive."reason" = 'SUBSCRIBER_TEST_DATA_RESET'
      AND archive."payload" = to_jsonb(OLD)
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Rights usage and attestation evidence is append-only';
END;
$$ LANGUAGE plpgsql;
