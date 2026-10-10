ALTER TABLE "CorrectionsEdgeNode" ADD COLUMN "playerEndpointOrigin" TEXT;
CREATE UNIQUE INDEX "CorrectionsEdgeNode_one_active_player_endpoint_per_facility"
ON "CorrectionsEdgeNode" ("facilityId")
WHERE "status" = 'ACTIVE' AND "playerEndpointOrigin" IS NOT NULL;
