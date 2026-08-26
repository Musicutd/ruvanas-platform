-- CreateTable
CREATE TABLE "LocationGroup" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationGroupMember" (
    "locationGroupId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationGroupMember_pkey" PRIMARY KEY ("locationGroupId", "locationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationGroup_organisationId_slug_key" ON "LocationGroup"("organisationId", "slug");
CREATE INDEX "LocationGroup_organisationId_idx" ON "LocationGroup"("organisationId");
CREATE INDEX "LocationGroupMember_locationId_idx" ON "LocationGroupMember"("locationId");

-- AddForeignKey
ALTER TABLE "LocationGroup" ADD CONSTRAINT "LocationGroup_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationGroupMember" ADD CONSTRAINT "LocationGroupMember_locationGroupId_fkey" FOREIGN KEY ("locationGroupId") REFERENCES "LocationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationGroupMember" ADD CONSTRAINT "LocationGroupMember_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

