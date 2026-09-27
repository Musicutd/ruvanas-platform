import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { correctionsNetworkPermission } from "@/lib/corrections-network-policy.mjs";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const FLAGS = Object.freeze({ view: "canView", manage: "canManage", policy: "canPolicy", programme: "canProgramme", distribute: "canDistribute", report: "canReport", audit: "canAudit" });

export async function correctionsNetworkAuthority(client, access, capability = "view") {
  if (!access?.ok) throw bad("Sign in to Ruvanas Inside.", 403);
  const member = await client.organisationMember.findFirst({ where: { id: access.context.membership.id, organisationId: access.organisationId, userId: access.context.user.id }, select: { id: true, role: true } });
  if (!member) throw bad("Your organisation access changed.", 403);
  const subscription = await client.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
  const entitlement = resolveEntitlements(subscription);
  const grant = member.role === "OWNER" ? null : await client.correctionsNetworkGrant.findUnique({ where: { organisationMemberId: member.id } });
  if (!correctionsNetworkPermission({ tier: entitlement.planTierNumber, correctionsEnabled: entitlement.correctionsRadioEnabled, role: member.role,
    grant, organisationId: access.organisationId, memberId: member.id, capability })) throw bad("Inside Network access is not available to this account.", 403);
  return { member, entitlement, grant };
}

export async function setCorrectionsNetworkGrant(access, input) {
  return runSerializableTransaction(prisma, async (tx) => {
    const { member: actor } = await correctionsNetworkAuthority(tx, access, "manage");
    if (actor.role !== "OWNER") throw bad("Only the authority owner can delegate network capabilities.", 403);
    const memberId = String(input.memberId || "");
    const member = await tx.organisationMember.findFirst({ where: { id: memberId, organisationId: access.organisationId }, select: { id: true, role: true } });
    if (!member || member.role === "OWNER" || member.role === "STUDENT") throw bad("Choose an eligible member of this authority.", 403);
    const data = Object.fromEntries(Object.values(FLAGS).map((flag) => [flag, input[flag] === true]));
    if (member.role !== "MANAGER" && ["canManage", "canPolicy", "canDistribute"].some((flag) => data[flag])) throw bad("Only an organisation manager can hold these network powers.", 403);
    if (member.role === "VIEWER" && data.canProgramme) throw bad("A viewer cannot manage network programmes.", 403);
    const grant = await tx.correctionsNetworkGrant.upsert({ where: { organisationMemberId: member.id },
      create: { organisationId: access.organisationId, organisationMemberId: member.id, createdByUserId: access.context.user.id, ...data }, update: data });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_GRANT_SAVED", entityType: "CorrectionsNetworkGrant", entityId: grant.id,
      details: { memberId: member.id, capabilities: Object.entries(FLAGS).filter(([, flag]) => data[flag]).map(([name]) => name) } } });
    return { id: grant.id, memberId: member.id, ...data };
  });
}

export async function listCorrectionsNetwork(access, requestedFacilityId = null) {
  const authority = await correctionsNetworkAuthority(prisma, access, "view");
  const facilities = await prisma.correctionsFacility.findMany({ where: { location: { organisationId: access.organisationId, status: { not: "CLOSED" } } },
    select: { locationId: true, policyConfiguredAt: true, location: { select: { name: true, status: true, countryCode: true,
      zones: { select: { id: true, status: true } } } } }, orderBy: { location: { name: "asc" } } });
  if (requestedFacilityId && !facilities.some((item) => item.locationId === requestedFacilityId)) throw bad("Facility not available in this authority.", 404);
  const selected = requestedFacilityId ? facilities.filter((item) => item.locationId === requestedFacilityId) : facilities;
  const ids = selected.map((item) => item.locationId);
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [players, programmeCounts, pendingReviews, requestCount, rehabCount, announcementCount, activeOverrides, distributions, groups, evidence, programmes, windows, studioProductions] = await Promise.all([
    prisma.player.findMany({ where: { organisationId: access.organisationId, zone: { locationId: { in: ids } }, retiredAt: null }, select: { status: true, lastHeartbeatAt: true, zone: { select: { locationId: true } } } }),
    prisma.correctionsProgramme.groupBy({ by: ["facilityId", "status"], where: { organisationId: access.organisationId, facilityId: { in: ids } }, _count: { _all: true } }),
    prisma.correctionsSubmission.count({ where: { organisationId: access.organisationId, facilityId: { in: ids }, status: { in: ["SUBMITTED", "STAFF_APPROVED"] } } }),
    prisma.correctionsRequest.count({ where: { organisationId: access.organisationId, facilityId: { in: ids }, createdAt: { gte: since } } }),
    prisma.correctionsRehabContent.count({ where: { organisationId: access.organisationId, OR: [{ facilityId: null }, { facilityId: { in: ids } }], status: "APPROVED" } }),
    prisma.correctionsAnnouncement.count({ where: { organisationId: access.organisationId, facilityId: { in: ids }, createdAt: { gte: since } } }),
    prisma.correctionsOverride.findMany({ where: { organisationId: access.organisationId, facilityId: { in: ids }, startedAt: { gte: since } }, select: { facilityId: true, type: true, status: true, startedAt: true }, orderBy: { startedAt: "desc" }, take: 50 }),
    prisma.correctionsProgrammeDistribution.findMany({ where: { organisationId: access.organisationId, targetFacilityId: { in: ids } }, select: { id: true, targetFacilityId: true, sourceFacilityId: true, status: true, effectiveFrom: true, effectiveUntil: true, programme: { select: { title: true } }, submission: { select: { revision: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.locationGroup.findMany({ where: { organisationId: access.organisationId }, select: { id: true, name: true, locations: { where: { locationId: { in: ids } }, select: { locationId: true } } }, take: 100 }),
    ids.length ? prisma.$queryRaw`SELECT z."locationId" AS "facilityId", p."eventType"::text AS "eventType", COALESCE(p."programmingSource", 'UNKNOWN') AS "source", COUNT(*)::int AS "events",
      COALESCE(SUM(CASE WHEN p."eventType" = 'COMPLETED' AND p."programmingSource" = 'CORRECTIONS_REHABILITATION' THEN m."durationSeconds" ELSE 0 END), 0)::int AS "rehabilitationSeconds"
      FROM "ProofOfPlayEvent" p JOIN "Zone" z ON z."id" = p."zoneId" JOIN "Location" l ON l."id" = z."locationId" JOIN "MediaAsset" m ON m."id" = p."mediaAssetId"
      WHERE p."organisationId" = ${access.organisationId} AND l."organisationId" = ${access.organisationId}
        AND z."locationId" = ANY(${ids}::text[]) AND p."occurredAt" >= ${since} AND p."programmingSource" LIKE 'CORRECTIONS_%'
      GROUP BY z."locationId", p."eventType", p."programmingSource"` : [],
    prisma.correctionsProgramme.findMany({ where: { organisationId: access.organisationId, facilityId: { in: ids }, status: "APPROVED" },
      select: { id: true, title: true, facilityId: true, latestRevision: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.correctionsNetworkWindow.findMany({ where: { organisationId: access.organisationId, facilityId: { in: ids } },
      select: { id: true, facilityId: true, kind: true, mandatory: true, weekday: true, startMinute: true, endMinute: true,
        allowedContentTypes: true, distributionId: true, active: true }, orderBy: [{ facilityId: "asc" }, { weekday: "asc" }, { startMinute: "asc" }], take: 500 }),
    prisma.correctionsStudioSession.groupBy({ by: ["facilityId"], where: { organisationId: access.organisationId, facilityId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } })
  ]);
  const facilityRows = selected.map((facility) => {
    const localPlayers = players.filter((item) => item.zone.locationId === facility.locationId);
    const online = localPlayers.filter((item) => item.status === "ONLINE" && item.lastHeartbeatAt && now.getTime() - item.lastHeartbeatAt.getTime() <= 90_000).length;
    return { id: facility.locationId, name: facility.location.name, status: facility.location.status, countryCode: facility.location.countryCode,
      policyReady: Boolean(facility.policyConfiguredAt), zones: facility.location.zones.length, onlinePlayers: online, offlinePlayers: localPlayers.length - online,
      approvedProgrammes: programmeCounts.filter((item) => item.facilityId === facility.locationId && item.status === "APPROVED").reduce((sum, item) => sum + item._count._all, 0),
      studioProductions: studioProductions.find((item) => item.facilityId === facility.locationId)?._count._all || 0,
      completedDeliveries: evidence.filter((item) => item.facilityId === facility.locationId && item.eventType === "COMPLETED").reduce((sum, item) => sum + Number(item.events), 0),
      failedDeliveries: evidence.filter((item) => item.facilityId === facility.locationId && item.eventType === "FAILED").reduce((sum, item) => sum + Number(item.events), 0) };
  });
  return { facilities: facilityRows, selectedFacilityId: requestedFacilityId, totals: { facilities: facilityRows.length,
    activeFacilities: facilityRows.filter((item) => item.status === "ACTIVE").length, zones: facilityRows.reduce((sum, item) => sum + item.zones, 0),
    onlinePlayers: facilityRows.reduce((sum, item) => sum + item.onlinePlayers, 0), offlinePlayers: facilityRows.reduce((sum, item) => sum + item.offlinePlayers, 0),
    pendingReviews, requestsLast7Days: requestCount, approvedRehabilitationItems: rehabCount, announcementsLast7Days: announcementCount,
    completedDeliveriesLast7Days: facilityRows.reduce((sum, item) => sum + item.completedDeliveries, 0),
    failedDeliveriesLast7Days: facilityRows.reduce((sum, item) => sum + item.failedDeliveries, 0) },
    groups: groups.map((item) => ({ id: item.id, name: item.name, facilityIds: item.locations.map((member) => member.locationId) })),
    permissions: Object.fromEntries(Object.keys(FLAGS).map((capability) => [capability,
      correctionsNetworkPermission({ tier: authority.entitlement.planTierNumber, correctionsEnabled: authority.entitlement.correctionsRadioEnabled,
        role: authority.member.role, grant: authority.grant, organisationId: access.organisationId, memberId: authority.member.id, capability })])),
    programmes, windows, distributions, overrideHistory: activeOverrides,
    deliveryBySource: evidence.reduce((rows, item) => {
      const current = rows.find((row) => row.source === item.source && row.status === item.eventType);
      if (current) current.playerEvents += Number(item.events);
      else rows.push({ source: item.source, status: item.eventType, playerEvents: Number(item.events) });
      return rows;
    }, []),
    rehabilitationDeliveredSecondsLast7Days: evidence.reduce((sum, item) => sum + Number(item.rehabilitationSeconds), 0),
    evidenceWindow: { from: since, to: now },
    note: "These are operational player and proof-of-play counts, not listener or rehabilitation outcomes." };
}
