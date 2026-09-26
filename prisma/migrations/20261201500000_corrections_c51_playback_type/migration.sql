-- PostgreSQL requires a newly added enum value to commit before it can be
-- referenced by a CHECK constraint in the next migration.
ALTER TYPE "PlaybackItemType" ADD VALUE 'CORRECTIONS_AUDIO';
