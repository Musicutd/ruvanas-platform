-- Preserve the newest active assignment and close any older duplicates before
-- enforcing the invariant. This makes the migration safe for existing data.
WITH ranked_active_assignments AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "zoneId"
      ORDER BY "activeFrom" DESC, "createdAt" DESC, "id" DESC
    ) AS assignment_rank
  FROM "ChannelAssignment"
  WHERE "activeTo" IS NULL
)
UPDATE "ChannelAssignment"
SET "activeTo" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "id"
  FROM ranked_active_assignments
  WHERE assignment_rank > 1
);

CREATE UNIQUE INDEX "ChannelAssignment_one_active_per_zone_key"
ON "ChannelAssignment"("zoneId")
WHERE "activeTo" IS NULL;
