-- An additive marker avoids adding enum values that older, running encoders
-- cannot deserialize. Existing tracks keep their prior catalogue requirements.
ALTER TABLE "Track" ADD COLUMN "catalogueAllTiers" BOOLEAN NOT NULL DEFAULT false;
