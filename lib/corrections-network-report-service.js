import { prisma } from "@/lib/prisma";
import { correctionsNetworkAuthority } from "@/lib/corrections-network-service";
import { CORRECTIONS_NETWORK_REPORT_SOURCES, normaliseCorrectionsNetworkReportFilters } from "@/lib/corrections-network-report.mjs";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export async function loadCorrectionsNetworkReport(access, input) {
  await correctionsNetworkAuthority(prisma, access, "report");
  const filters = normaliseCorrectionsNetworkReportFilters(input);
  const facilities = await prisma.correctionsFacility.findMany({ where: { location: { organisationId: access.organisationId } },
    select: { locationId: true, location: { select: { name: true } } } });
  let ids = facilities.map((facility) => facility.locationId);
  if (filters.facilityId) {
    if (!ids.includes(filters.facilityId)) throw bad("Facility not available in this authority.", 404);
    ids = [filters.facilityId];
  } else if (filters.groupId) {
    const group = await prisma.locationGroup.findFirst({ where: { id: filters.groupId, organisationId: access.organisationId },
      select: { locations: { select: { locationId: true } } } });
    if (!group) throw bad("Facility group not available in this authority.", 404);
    const members = new Set(group.locations.map((item) => item.locationId));
    ids = ids.filter((id) => members.has(id));
  }
  if (!ids.length) return { filters, rows: [] };
  const sources = [...CORRECTIONS_NETWORK_REPORT_SOURCES];
  const raw = await prisma.$queryRaw`SELECT p."occurredAt"::date::text AS "date",
    z."locationId" AS "facilityId", p."programmingSource" AS "source", p."eventType"::text AS "status",
    COUNT(*)::int AS "playerEvents"
    FROM "ProofOfPlayEvent" p JOIN "Zone" z ON z."id" = p."zoneId" JOIN "Location" l ON l."id" = z."locationId"
    WHERE p."organisationId" = ${access.organisationId} AND l."organisationId" = ${access.organisationId}
      AND z."locationId" = ANY(${ids}::text[]) AND p."occurredAt" >= ${filters.fromInstant}
      AND p."occurredAt" < ${filters.until} AND p."programmingSource" = ANY(${sources}::text[])
      AND (${filters.source}::text IS NULL OR p."programmingSource" = ${filters.source})
      AND (${filters.status}::text IS NULL OR p."eventType"::text = ${filters.status})
    GROUP BY p."occurredAt"::date, z."locationId", p."programmingSource", p."eventType"
    ORDER BY "date", "facilityId", "source", "status" LIMIT 50001`;
  if (raw.length > 50000) throw bad("Reduce the date range before exporting more than 50,000 summary rows.", 413);
  const names = new Map(facilities.map((facility) => [facility.locationId, facility.location.name]));
  return { filters, rows: raw.map((item) => ({ date: item.date, facility: names.get(item.facilityId) || item.facilityId,
    source: item.source, status: item.status, playerEvents: Number(item.playerEvents) })) };
}
