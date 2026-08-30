-- Stage 12C: provider-neutral service heartbeat and release visibility.

CREATE TYPE "OperationalServiceKind" AS ENUM ('WEB', 'OPERATIONS_WORKER', 'AUDIO_WORKER');

CREATE TABLE "OperationalServiceHeartbeat" (
    "id" TEXT NOT NULL,
    "service" "OperationalServiceKind" NOT NULL,
    "environment" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "commitSha" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalServiceHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalServiceHeartbeat_service_environment_instanceId_key"
ON "OperationalServiceHeartbeat"("service", "environment", "instanceId");

CREATE INDEX "OperationalServiceHeartbeat_service_environment_lastSeenAt_idx"
ON "OperationalServiceHeartbeat"("service", "environment", "lastSeenAt");

CREATE INDEX "OperationalServiceHeartbeat_version_lastSeenAt_idx"
ON "OperationalServiceHeartbeat"("version", "lastSeenAt");
