-- PostgreSQL requires newly-added enum values to be committed before they are
-- referenced by later constraints. Keep these additions in their own migration.
ALTER TYPE "DigitalSignageAssetStatus" ADD VALUE 'PROCESSING' BEFORE 'READY';
ALTER TYPE "DigitalSignageAssetStatus" ADD VALUE 'FAILED' AFTER 'READY';
