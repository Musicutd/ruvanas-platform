CREATE TABLE "LocationOpeningHour" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "opensAtMinute" INTEGER,
    "closesAtMinute" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LocationOpeningHour_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LocationOpeningHour_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "LocationOpeningHour_time_check" CHECK (
      ("isClosed" = true AND "opensAtMinute" IS NULL AND "closesAtMinute" IS NULL)
      OR
      ("isClosed" = false AND "opensAtMinute" BETWEEN 0 AND 1439 AND "closesAtMinute" BETWEEN 0 AND 1439 AND "opensAtMinute" <> "closesAtMinute")
    )
);

CREATE TABLE "LocationOpeningException" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT true,
    "opensAtMinute" INTEGER,
    "closesAtMinute" INTEGER,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LocationOpeningException_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LocationOpeningException_time_check" CHECK (
      ("isClosed" = true AND "opensAtMinute" IS NULL AND "closesAtMinute" IS NULL)
      OR
      ("isClosed" = false AND "opensAtMinute" BETWEEN 0 AND 1439 AND "closesAtMinute" BETWEEN 0 AND 1439 AND "opensAtMinute" <> "closesAtMinute")
    )
);

CREATE UNIQUE INDEX "LocationOpeningHour_locationId_weekday_key" ON "LocationOpeningHour"("locationId", "weekday");
CREATE INDEX "LocationOpeningHour_locationId_idx" ON "LocationOpeningHour"("locationId");
CREATE UNIQUE INDEX "LocationOpeningException_locationId_date_key" ON "LocationOpeningException"("locationId", "date");
CREATE INDEX "LocationOpeningException_locationId_date_idx" ON "LocationOpeningException"("locationId", "date");

ALTER TABLE "LocationOpeningHour" ADD CONSTRAINT "LocationOpeningHour_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationOpeningException" ADD CONSTRAINT "LocationOpeningException_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
