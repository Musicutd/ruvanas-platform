-- ORG.1-ORG.12: additive sixth-product authority and genuinely new organisation-media concepts.
ALTER TABLE "Plan" ADD COLUMN "organisationsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription"
  ADD COLUMN "organisationsEnabled" BOOLEAN,
  ADD COLUMN "complimentaryOrganisationsEnabled" BOOLEAN;

CREATE TABLE "OrganisationMediaProfile" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "template" "OrganisationMediaTemplate" NOT NULL DEFAULT 'GENERAL',
  "locale" TEXT NOT NULL DEFAULT 'en-MT',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Malta',
  "regionalPriceBookCurrency" TEXT NOT NULL DEFAULT 'EUR',
  "terminology" JSONB,
  "disclosureText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganisationMediaProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganisationMediaProfile_organisationId_key" ON "OrganisationMediaProfile"("organisationId");
CREATE INDEX "OrganisationMediaProfile_template_idx" ON "OrganisationMediaProfile"("template");
ALTER TABLE "OrganisationMediaProfile" ADD CONSTRAINT "OrganisationMediaProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrganisationAnnouncement" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "OrganisationAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "surfaces" "OrganisationAnnouncementSurface"[] NOT NULL,
  "targetLocationIds" JSONB,
  "targetStationIds" JSONB,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "publishedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganisationAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrganisationAnnouncement_organisationId_status_startsAt_endsAt_idx" ON "OrganisationAnnouncement"("organisationId", "status", "startsAt", "endsAt");
ALTER TABLE "OrganisationAnnouncement" ADD CONSTRAINT "OrganisationAnnouncement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrganisationEvent" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "OrganisationEventStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "stationId" TEXT,
  "channelId" TEXT,
  "fallbackAutoDjPolicyId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "lastTransitionByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganisationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrganisationEvent_organisationId_status_startsAt_endsAt_idx" ON "OrganisationEvent"("organisationId", "status", "startsAt", "endsAt");
CREATE INDEX "OrganisationEvent_organisationId_stationId_idx" ON "OrganisationEvent"("organisationId", "stationId");
CREATE INDEX "OrganisationEvent_organisationId_channelId_idx" ON "OrganisationEvent"("organisationId", "channelId");
ALTER TABLE "OrganisationEvent" ADD CONSTRAINT "OrganisationEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrganisationSponsorProfile" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "disclosureText" TEXT,
  "status" "OrganisationSponsorStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganisationSponsorProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganisationSponsorProfile_organisationId_name_key" ON "OrganisationSponsorProfile"("organisationId", "name");
CREATE INDEX "OrganisationSponsorProfile_organisationId_status_idx" ON "OrganisationSponsorProfile"("organisationId", "status");
ALTER TABLE "OrganisationSponsorProfile" ADD CONSTRAINT "OrganisationSponsorProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrganisationBranchAssignment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "organisationMemberId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "permission" "OrganisationBranchPermission" NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganisationBranchAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganisationBranchAssignment_organisationMemberId_locationId_key" ON "OrganisationBranchAssignment"("organisationMemberId", "locationId");
CREATE INDEX "OrganisationBranchAssignment_organisationId_locationId_permission_idx" ON "OrganisationBranchAssignment"("organisationId", "locationId", "permission");
ALTER TABLE "OrganisationBranchAssignment" ADD CONSTRAINT "OrganisationBranchAssignment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganisationBranchAssignment" ADD CONSTRAINT "OrganisationBranchAssignment_organisationMemberId_fkey" FOREIGN KEY ("organisationMemberId") REFERENCES "OrganisationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganisationBranchAssignment" ADD CONSTRAINT "OrganisationBranchAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Plan" (
  "id", "name", "code", "publicSlug", "productFamily", "tierNumber", "publiclyAvailable",
  "monthlyPriceCents", "stationLimit", "storageLimitGb", "listenerLimit", "maxBitrateKbps",
  "includesRuvanasCatalogue", "licensedMusicCatalogueLevel", "promoUploadEnabled",
  "retailRadioEnabled", "schoolRadioEnabled", "onlineRadioEnabled", "healthRadioEnabled", "faithRadioEnabled", "organisationsEnabled",
  "schoolPublicPublishingEnabled", "retailMediaEnabled", "digitalSignageEnabled", "active", "createdAt", "updatedAt"
) VALUES
  ('public-plan-organisations-start', 'Organisations Start', 'ORGANISATIONS_START', 'organisations-start', 'ORGANISATIONS', 1, true, 2490, 1, 25, 250, 192, true, 'NONE', true, false, false, false, false, false, true, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-organisations-connect', 'Organisations Connect', 'ORGANISATIONS_CONNECT', 'organisations-connect', 'ORGANISATIONS', 2, true, 5900, 2, 100, 1000, 256, true, 'NONE', true, false, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-organisations-pro', 'Organisations Pro', 'ORGANISATIONS_PRO', 'organisations-pro', 'ORGANISATIONS', 3, true, 12900, 5, 300, 5000, 320, true, 'FOCUSED', true, false, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-organisations-network', 'Organisations Network', 'ORGANISATIONS_NETWORK', 'organisations-network', 'ORGANISATIONS', 4, true, 29900, 15, 1000, 20000, 320, true, 'PROFESSIONAL', true, false, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-organisations-enterprise', 'Organisations Enterprise', 'ORGANISATIONS_ENTERPRISE', 'organisations-enterprise', 'ORGANISATIONS', 5, true, 69900, 50, 3000, 100000, 320, true, 'PREMIUM', true, false, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name", "publicSlug" = EXCLUDED."publicSlug", "productFamily" = EXCLUDED."productFamily",
  "tierNumber" = EXCLUDED."tierNumber", "publiclyAvailable" = EXCLUDED."publiclyAvailable", "monthlyPriceCents" = EXCLUDED."monthlyPriceCents",
  "stationLimit" = EXCLUDED."stationLimit", "storageLimitGb" = EXCLUDED."storageLimitGb", "listenerLimit" = EXCLUDED."listenerLimit",
  "maxBitrateKbps" = EXCLUDED."maxBitrateKbps", "licensedMusicCatalogueLevel" = EXCLUDED."licensedMusicCatalogueLevel",
  "organisationsEnabled" = EXCLUDED."organisationsEnabled", "digitalSignageEnabled" = EXCLUDED."digitalSignageEnabled", "active" = EXCLUDED."active", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Organisation" ("id", "name", "slug", "createdAt", "updatedAt") VALUES
  ('qa-organisations-organisation', 'Ruvanas Organisations QA', 'ruvanas-organisations-qa', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "OrganisationMediaProfile" ("id", "organisationId", "template", "locale", "timezone", "regionalPriceBookCurrency", "createdAt", "updatedAt")
SELECT 'qa-organisations-media-profile', organisation."id", 'GENERAL', 'en-MT', 'Europe/Malta', 'EUR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organisation" organisation WHERE organisation."slug" = 'ruvanas-organisations-qa'
ON CONFLICT ("organisationId") DO NOTHING;

INSERT INTO "Subscription" ("id", "organisationId", "planId", "status", "currentPeriodEnd", "createdAt", "updatedAt")
SELECT 'qa-organisations-subscription', organisation."id", plan."id", 'TRIAL', CURRENT_TIMESTAMP + INTERVAL '10 years', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organisation" organisation, "Plan" plan
WHERE organisation."slug" = 'ruvanas-organisations-qa' AND plan."code" = 'ORGANISATIONS_PRO'
ON CONFLICT ("organisationId") DO NOTHING;
