-- PostgreSQL requires a newly added enum value to be committed before it is
-- referenced by constraints or data in a subsequent migration.
ALTER TYPE "RadioClockItemType" ADD VALUE IF NOT EXISTS 'VOICE_TRACK';
