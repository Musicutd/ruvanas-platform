CREATE TABLE "CorrectionsProfile" (
  "organisationId" TEXT NOT NULL,
  "cleanOnly" BOOLEAN NOT NULL DEFAULT true,
  "allowedGenres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "restrictedGenres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockedTrackIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockedArtists" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "policyConfiguredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsProfile_pkey" PRIMARY KEY ("organisationId")
);

CREATE TABLE "CorrectionsFacility" (
  "locationId" TEXT NOT NULL,
  "youthFacility" BOOLEAN NOT NULL DEFAULT false,
  "allowedGenres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "restrictedGenres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockedTrackIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockedArtists" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "policyConfiguredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsFacility_pkey" PRIMARY KEY ("locationId")
);

ALTER TABLE "CorrectionsProfile" ADD CONSTRAINT "CorrectionsProfile_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsFacility" ADD CONSTRAINT "CorrectionsFacility_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
