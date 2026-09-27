import { prisma } from "@/lib/prisma";
import { correctionsNetworkAuthority } from "@/lib/corrections-network-service";
import { correctionsNetworkDistributionReference, correctionsNetworkReportClassification, correctionsNetworkReportKind, normaliseCorrectionsNetworkReportFilters } from "@/lib/corrections-network-report.mjs";

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
  if (!filters.allowedSources.length) return { filters, rows: [] };
  // Export individual verified player events, not grouped totals. The proof
  // and intent references let auditors reproduce each claim after withdrawal.
  const raw = await prisma.proofOfPlayEvent.findMany({ where: {
    organisationId: access.organisationId,
    zone: { locationId: { in: ids }, location: { organisationId: access.organisationId } },
    occurredAt: { gte: filters.fromInstant, lt: filters.until },
    programmingSource: { in: filters.source ? [filters.source] : filters.allowedSources },
    playoutIntentId: { not: null },
    ...(filters.status ? { eventType: filters.status } : {}),
    playoutIntent: { is: { organisationId: access.organisationId, locationId: { in: ids },
      ...(filters.programmeId ? { correctionsProgrammeId: filters.programmeId } : {}),
      ...(filters.rehabilitationId ? { correctionsRehabContentId: filters.rehabilitationId } : {}),
      ...(filters.announcementId ? { correctionsAnnouncementId: filters.announcementId } : {}),
      ...(filters.kind === "REQUEST" ? { correctionsRequestId: { not: null } } : {})
    } }
  }, select: { id: true, occurredAt: true, programmingSource: true, eventType: true,
    zone: { select: { locationId: true } }, playoutIntent: { select: { id: true, sourceRevision: true,
      correctionsProgrammeId: true, correctionsSubmissionId: true, correctionsRehabContentId: true,
      correctionsAnnouncementId: true } } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 50001 });
  if (raw.length > 50000) throw bad("Reduce the date range before exporting more than 50,000 proof rows.", 413);
  const names = new Map(facilities.map((facility) => [facility.locationId, facility.location.name]));
  const references = raw.map((item) => correctionsNetworkDistributionReference(item.playoutIntent.sourceRevision));
  const programmeIds = [...new Set(references.filter((ref) => ref?.type === "programme").map((ref) => ref.id))];
  const audioIds = [...new Set(references.filter((ref) => ref?.type === "audio").map((ref) => ref.id))];
  const [programmeDistributions, audioDistributions] = await Promise.all([
    programmeIds.length ? prisma.correctionsProgrammeDistribution.findMany({ where: {
      id: { in: programmeIds }, organisationId: access.organisationId }, select: {
      id: true, targetFacilityId: true, targetGroupId: true, targetGroupName: true } }) : [],
    audioIds.length ? prisma.correctionsNetworkAudioDistribution.findMany({ where: {
      id: { in: audioIds }, organisationId: access.organisationId }, select: {
      id: true, targetFacilityId: true, targetGroupId: true, targetGroupName: true } }) : []
  ]);
  const distributions = new Map([...programmeDistributions, ...audioDistributions].map((item) =>
    [`${item.id}:${item.targetFacilityId}`, item]));
  return { filters, rows: raw.map((item, index) => {
    const group = references[index] ? distributions.get(`${references[index].id}:${item.zone.locationId}`) : null;
    return { occurredAt: item.occurredAt.toISOString(),
    facility: names.get(item.zone.locationId) || item.zone.locationId, facilityId: item.zone.locationId,
    facilityGroup: group?.targetGroupName || null, facilityGroupId: group?.targetGroupId || null,
    classification: correctionsNetworkReportClassification(item.programmingSource),
    kind: correctionsNetworkReportKind(item.programmingSource), source: item.programmingSource, status: item.eventType,
    proofEventId: item.id, playoutIntentId: item.playoutIntent.id, sourceRevision: item.playoutIntent.sourceRevision,
    programmeId: item.playoutIntent.correctionsProgrammeId, submissionId: item.playoutIntent.correctionsSubmissionId,
    rehabilitationId: item.playoutIntent.correctionsRehabContentId, announcementId: item.playoutIntent.correctionsAnnouncementId };
  }) };
}
