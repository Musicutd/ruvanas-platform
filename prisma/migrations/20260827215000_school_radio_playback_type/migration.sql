-- PostgreSQL requires a newly added enum value to commit before later migrations use it.
ALTER TYPE "PlaybackItemType" ADD VALUE IF NOT EXISTS 'SCHOOL_ANNOUNCEMENT';
