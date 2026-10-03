-- Existing StudioPlayoutSession rows already have an Organisation FK from the
-- original Studio migration. StudioProgrammePack did not, allowing a pack to
-- be inserted during trial-organisation deletion after its evidence check.
-- Do not silently discard or reassign any pre-existing orphaned packs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudioProgrammePack" AS pack
    LEFT JOIN "Organisation" AS organisation ON organisation."id" = pack."organisationId"
    WHERE organisation."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'StudioProgrammePack contains orphan organisationId values; reconcile them before this migration';
  END IF;
END $$;

ALTER TABLE "StudioProgrammePack"
  ADD CONSTRAINT "StudioProgrammePack_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
