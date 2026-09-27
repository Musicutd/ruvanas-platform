-- Capture the programme's original network authority once. Later role or
-- grant changes must never turn a facility submission into central content.
CREATE TYPE "CorrectionsNetworkOrigin" AS ENUM ('CENTRAL', 'FACILITY');
ALTER TABLE "CorrectionsProgramme" ADD COLUMN "networkOrigin" "CorrectionsNetworkOrigin" NOT NULL DEFAULT 'FACILITY';

-- Existing owner-authored programmes were created with authority-wide
-- privilege; ambiguous or delegated programmes remain facility-scoped.
UPDATE "CorrectionsProgramme" AS programme
SET "networkOrigin" = 'CENTRAL'
FROM "OrganisationMember" AS member
WHERE member."organisationId" = programme."organisationId"
  AND member."userId" = programme."createdByUserId"
  AND member."role" = 'OWNER';
