ALTER TABLE "Session" ADD COLUMN "activeOrganisationId" TEXT;

CREATE INDEX "Session_activeOrganisationId_idx" ON "Session"("activeOrganisationId");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_activeOrganisationId_fkey"
  FOREIGN KEY ("activeOrganisationId") REFERENCES "Organisation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Session" AS session
SET "activeOrganisationId" = (
  SELECT member."organisationId"
  FROM "OrganisationMember" AS member
  WHERE member."userId" = session."userId"
  ORDER BY member."createdAt" ASC, member."id" ASC
  LIMIT 1
)
WHERE session."activeOrganisationId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "OrganisationMember" AS member
    WHERE member."userId" = session."userId"
  );

