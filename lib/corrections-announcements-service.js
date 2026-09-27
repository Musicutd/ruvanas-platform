import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import {
  CORRECTIONS_OVERRIDE_CATEGORIES, correctionsAnnouncementApproval,
  correctionsAnnouncementPermission, correctionsOverrideConflict
} from "@/lib/corrections-c6-policy.mjs";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const managedAudio = { mediaType: { in: ["ANNOUNCEMENT", "VOICEOVER"] }, status: "READY", libraryType: "ORGANISATION_PROMO" };

async function authority(tx, access, facilityId, action) {
  const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id } });
  if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId) throw bad("Your organisation access changed.", 403);
  const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
  const entitlements = resolveEntitlements(subscription);
  const facility = await tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId: access.organisationId, status: "ACTIVE" } }, include: { location: { select: { name: true, timezone: true, countryCode: true } } } });
  if (!facility || !facility.policyConfiguredAt || !facility.location.countryCode || !entitlements.correctionsRadioEnabled) throw bad("This active Inside facility is not available.", 403);
  const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId } } });
  const scopedGrant = grant?.organisationId === access.organisationId ? grant : null;
  if (!correctionsAnnouncementPermission({ role: member.role, grant: scopedGrant, action, facility, tier: Number(entitlements.planTierNumber) })) throw bad("You do not have this facility announcement permission.", 403);
  return { member, facility, grant: scopedGrant, tier: Number(entitlements.planTierNumber) };
}

async function approvedMedia(tx, organisationId, promoVersionId) {
  const version = await tx.promoVersion.findFirst({ where: { id: promoVersionId, status: "APPROVED", qcStatus: "PASSED", promoAsset: { organisationId, status: "ACTIVE", mediaType: { in: ["ANNOUNCEMENT", "VOICEOVER"] }, currentApprovedVersionId: promoVersionId }, mediaAsset: { organisationId, ...managedAudio } }, include: { mediaAsset: true, promoAsset: true } });
  const duration = Number(version?.mediaAsset?.durationSeconds);
  if (!version || !/^[0-9a-f]{64}$/i.test(version.checksumSha256 || "") || !Number.isFinite(duration) || duration < 2 || duration > 900) throw bad("Choose a current, QC-passed announcement recording of 2–900 seconds owned by this organisation.", 409);
  return version;
}

async function approvedAnnouncement(tx, organisationId, facilityId, announcementId) {
  const announcement = await tx.correctionsAnnouncement.findFirst({ where: { id: announcementId, organisationId, facilityId, status: "APPROVED" } });
  if (!announcement) throw bad("Choose an approved announcement for this facility.", 409);
  const media = await approvedMedia(tx, organisationId, announcement.promoVersionId);
  if (media.mediaAssetId !== announcement.mediaAssetId) throw bad("The approved announcement version changed. Create a new announcement.", 409);
  return { announcement, media };
}

async function targets(tx, access, facility, zoneIds, instant, expiresAt, tier, limitedPriority = false) {
  if (!Array.isArray(zoneIds) || !zoneIds.length || zoneIds.length > 50 || zoneIds.some((id) => typeof id !== "string")) throw bad("Select one or more facility areas.");
  const ids = [...new Set(zoneIds)].sort();
  if (limitedPriority && tier === 1 && ids.length > 1) throw bad("Inside Essential permits one Priority area at a time.", 403);
  const zones = await tx.zone.findMany({ where: { id: { in: ids }, locationId: facility.locationId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (zones.length !== ids.length) throw bad("One or more areas are outside this active facility.", 403);
  const result = [];
  for (const zone of zones) {
    const assignment = await tx.channelAssignment.findFirst({ where: { zoneId: zone.id, activeFrom: { lte: instant }, OR: [{ activeTo: null }, { activeTo: { gt: expiresAt } }], channel: { organisationId: access.organisationId, status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO", station: { productFamily: "CORRECTIONS" } } }, select: { channelId: true } });
    if (!assignment) throw bad(`${zone.name} needs an active private Inside channel covering the broadcast window.`, 409);
    const players = await tx.player.findMany({ where: { organisationId: access.organisationId, zoneId: zone.id, status: { in: ["ONLINE", "OFFLINE"] }, sessionTokenHash: { not: null }, retiredAt: null }, select: { id: true, name: true, lastHeartbeatAt: true, status: true } });
    if (!players.length) throw bad(`${zone.name} has no enrolled player. No broadcast was started.`, 409);
    result.push({ zone, channelId: assignment.channelId, players });
  }
  return result;
}

function intentData({ access, facility, target, player, announcement, media, startsAt, expiresAt, overrideId = null }) {
  return {
    scheduleItemId: hash(["inside-c6", announcement.id, overrideId || "standard", target.zone.id, player.id, startsAt.toISOString()].join(":")),
    organisationId: access.organisationId, playerId: player.id, zoneId: target.zone.id, channelId: target.channelId,
    locationId: facility.locationId, locationName: facility.location.name, locationTimezone: facility.location.timezone, locationGroups: [],
    publicationRevision: media.version, sourceRevision: `${announcement.id}:${media.id}:${media.checksumSha256}`,
    mediaAssetId: media.mediaAssetId, promoVersionId: media.id,
    correctionsAnnouncementId: announcement.id, correctionsOverrideId: overrideId,
    plannedStart: startsAt, expiresAt
  };
}

export async function createCorrectionsAnnouncement(access, input) {
  const facilityId = String(input.facilityId || "");
  const title = String(input.title || "").trim();
  if (title.length < 3 || title.length > 160) throw bad("Give the announcement a title of 3–160 characters.");
  return runSerializableTransaction(prisma, async (tx) => {
    await authority(tx, access, facilityId, "CREATE");
    const media = await approvedMedia(tx, access.organisationId, String(input.promoVersionId || ""));
    const announcement = await tx.correctionsAnnouncement.create({ data: { organisationId: access.organisationId, facilityId, title, mediaAssetId: media.mediaAssetId, promoVersionId: media.id, createdByUserId: access.context.user.id } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_ANNOUNCEMENT_CREATED", entityType: "CorrectionsAnnouncement", entityId: announcement.id, details: { facilityId, mediaAssetId: media.mediaAssetId, promoVersionId: media.id } } });
    return announcement;
  });
}

export async function approveCorrectionsAnnouncement(access, announcementId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const announcement = await tx.correctionsAnnouncement.findFirst({ where: { id: announcementId, organisationId: access.organisationId } });
    if (!announcement) throw bad("Announcement not found.", 404);
    const { facility } = await authority(tx, access, announcement.facilityId, "APPROVE");
    await approvedMedia(tx, access.organisationId, announcement.promoVersionId);
    const step = correctionsAnnouncementApproval({ announcement, mode: facility.announcementApprovalMode, reviewerId: access.context.user.id, second: Boolean(announcement.approvedByUserId) });
    if (!step) throw bad("An independent authorised reviewer is required by facility policy.", 403);
    const saved = await tx.correctionsAnnouncement.update({ where: { id: announcement.id }, data: step === "FIRST" ? { approvedByUserId: access.context.user.id } : { status: "APPROVED", approvedAt: new Date(), ...(announcement.approvedByUserId ? { secondApproverUserId: access.context.user.id } : { approvedByUserId: access.context.user.id }) } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: step === "FIRST" ? "CORRECTIONS_ANNOUNCEMENT_FIRST_APPROVAL" : "CORRECTIONS_ANNOUNCEMENT_APPROVED", entityType: "CorrectionsAnnouncement", entityId: announcement.id, details: { facilityId: announcement.facilityId, promoVersionId: announcement.promoVersionId, approvalMode: facility.announcementApprovalMode } } });
    return saved;
  });
}

export async function scheduleCorrectionsAnnouncement(access, announcementId, input) {
  const startsAt = new Date(input.startsAt);
  if (!input.startsAt || Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 300_000 || startsAt.getTime() > Date.now() + 30 * 86_400_000) throw bad("Choose a time 5 minutes to 30 days ahead.");
  return runSerializableTransaction(prisma, async (tx) => {
    const announcement = await tx.correctionsAnnouncement.findFirst({ where: { id: announcementId, organisationId: access.organisationId } });
    if (!announcement) throw bad("Announcement not found.", 404);
    const { facility, tier } = await authority(tx, access, announcement.facilityId, "SCHEDULE");
    const approved = await approvedAnnouncement(tx, access.organisationId, facility.locationId, announcementId);
    const expiresAt = new Date(startsAt.getTime() + (Number(approved.media.mediaAsset.durationSeconds) + 90) * 1000);
    const scoped = await targets(tx, access, facility, input.zoneIds, startsAt, expiresAt, tier);
    const playerIds = scoped.flatMap((item) => item.players.map((player) => player.id));
    if (await tx.playoutIntent.count({ where: { playerId: { in: playerIds }, cancelledAt: null, plannedStart: { lt: expiresAt }, expiresAt: { gt: startsAt }, correctionsOverrideId: null } })) throw bad("Another normal delivery already occupies this player and time window.", 409);
    await tx.playoutIntent.createMany({ data: scoped.flatMap((item) => item.players.map((player) => intentData({ access, facility, target: item, player, ...approved, startsAt, expiresAt }))) });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_ANNOUNCEMENT_SCHEDULED", entityType: "CorrectionsAnnouncement", entityId: announcement.id, details: { facilityId: facility.locationId, zoneIds: scoped.map((item) => item.zone.id), playerCount: playerIds.length, startsAt: startsAt.toISOString() } } });
    return { startsAt, expiresAt, playerCount: playerIds.length };
  });
}

export async function startCorrectionsOverride(access, input) {
  const facilityId = String(input.facilityId || "");
  const type = String(input.type || "");
  const category = String(input.category || "");
  const key = String(input.idempotencyKey || "");
  if (!["PRIORITY", "EMERGENCY"].includes(type) || !CORRECTIONS_OVERRIDE_CATEGORIES.includes(category) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw bad("Choose an override type, category and unique request key.");
  if (type === "EMERGENCY" && input.confirmation !== "START EMERGENCY") throw bad("Explicit Emergency confirmation is required.", 403);
  return runSerializableTransaction(prisma, async (tx) => {
    const { facility, tier } = await authority(tx, access, facilityId, type === "PRIORITY" ? "PRIORITY_ACTIVATE" : "EMERGENCY_ACTIVATE");
    if (facility.emergencyDualControl && type === "EMERGENCY") throw bad("This facility requires independent Emergency confirmation; activation is locked until dual control is configured.", 403);
    if (input.drill === true && (type !== "EMERGENCY" || !facility.emergencyDrillsEnabled || category !== "TEST_DRILL")) throw bad("Emergency drills are not enabled for this facility.", 403);
    if (category === "TEST_DRILL" && input.drill !== true) throw bad("Label test broadcasts as drills.");
    await tx.$queryRaw`SELECT "locationId" FROM "CorrectionsFacility" WHERE "locationId" = ${facilityId} FOR UPDATE`;
    const existing = await tx.correctionsOverride.findUnique({ where: { organisationId_idempotencyKey: { organisationId: access.organisationId, idempotencyKey: key } } });
    if (existing) {
      if (existing.facilityId !== facilityId || existing.type !== type || existing.announcementId !== input.announcementId || existing.category !== category || existing.drill !== (input.drill === true) || JSON.stringify([...existing.targetZoneIds].sort()) !== JSON.stringify([...new Set(input.zoneIds || [])].sort())) throw bad("This request key was already used for a different override.", 409);
      return { override: existing, alreadyStarted: true };
    }
    const approved = await approvedAnnouncement(tx, access.organisationId, facilityId, String(input.announcementId || ""));
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + (Number(approved.media.mediaAsset.durationSeconds) + 90) * 1000);
    const scoped = await targets(tx, access, facility, input.zoneIds, startsAt, expiresAt, tier, type === "PRIORITY");
    const zoneIds = scoped.map((item) => item.zone.id).sort();
    const active = await tx.correctionsOverride.findMany({ where: { organisationId: access.organisationId, facilityId, status: "ACTIVE", expiresAt: { gt: startsAt }, targetZoneIds: { hasSome: zoneIds } } });
    for (const item of active) { const conflict = correctionsOverrideConflict(item, type); if (conflict) throw bad(conflict, 409); }
    if (type === "EMERGENCY" && active.length) {
      await tx.correctionsOverride.updateMany({ where: { id: { in: active.map((item) => item.id) }, status: "ACTIVE" }, data: { status: "SUPERSEDED", endedAt: startsAt, endedByUserId: access.context.user.id } });
      await tx.playoutIntent.updateMany({ where: { correctionsOverrideId: { in: active.map((item) => item.id) }, cancelledAt: null }, data: { cancelledAt: startsAt } });
      for (const item of active) await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_PRIORITY_SUPERSEDED", entityType: "CorrectionsOverride", entityId: item.id, details: { by: "EMERGENCY", facilityId, zoneIds: item.targetZoneIds } } });
    }
    const players = scoped.flatMap((item) => item.players);
    const override = await tx.correctionsOverride.create({ data: { organisationId: access.organisationId, facilityId, announcementId: approved.announcement.id, type, category, drill: input.drill === true, targetZoneIds: zoneIds, targetPlayerIds: players.map((player) => player.id), idempotencyKey: key, initiatedByUserId: access.context.user.id, startedAt: startsAt, expiresAt } });
    await tx.playoutIntent.createMany({ data: scoped.flatMap((item) => item.players.map((player) => intentData({ access, facility, target: item, player, ...approved, startsAt, expiresAt, overrideId: override.id }))) });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: `CORRECTIONS_${type}_INITIATED`, entityType: "CorrectionsOverride", entityId: override.id, details: { facilityId, zoneIds, playerIds: players.map((player) => player.id), category, drill: override.drill, expiresAt: expiresAt.toISOString() } } });
    await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: type === "EMERGENCY" ? "CRITICAL" : "INFO", title: `${type === "EMERGENCY" ? "Emergency" : "Priority"} Inside override active${override.drill ? " · drill" : ""}`, message: `Facility ${facility.location.name}: ${zoneIds.length} areas targeted. Delivery requires player proof.`, entityType: "CorrectionsOverride", entityId: override.id, dedupeKey: `inside-override-start:${override.id}`, correlationId: override.id });
    const offlinePlayers = players.filter((player) => player.status !== "ONLINE" || !player.lastHeartbeatAt || startsAt.getTime() - player.lastHeartbeatAt.getTime() > 90_000).map((player) => ({ id: player.id, name: player.name }));
    if (offlinePlayers.length) await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "PLAYER_OFFLINE", severity: type === "EMERGENCY" ? "CRITICAL" : "WARNING", title: "Inside override has unavailable players", message: `${offlinePlayers.length} targeted player(s) were unavailable at activation. Delivery is not confirmed.`, entityType: "CorrectionsOverride", entityId: override.id, dedupeKey: `inside-override-offline:${override.id}`, correlationId: override.id });
    return { override, playerCount: players.length, offlinePlayers };
  });
}

export async function clearCorrectionsOverride(access, overrideId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const override = await tx.correctionsOverride.findFirst({ where: { id: overrideId, organisationId: access.organisationId } });
    if (!override) throw bad("Override not found.", 404);
    await authority(tx, access, override.facilityId, override.type === "EMERGENCY" ? "EMERGENCY_CLEAR" : "PRIORITY_STOP");
    await tx.$queryRaw`SELECT "locationId" FROM "CorrectionsFacility" WHERE "locationId" = ${override.facilityId} FOR UPDATE`;
    if (override.status !== "ACTIVE") return { override, alreadyEnded: true };
    const endedAt = new Date();
    const saved = await tx.correctionsOverride.update({ where: { id: override.id }, data: { status: "CLEARED", endedAt, endedByUserId: access.context.user.id } });
    await tx.playoutIntent.updateMany({ where: { correctionsOverrideId: override.id, cancelledAt: null }, data: { cancelledAt: endedAt } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: `CORRECTIONS_${override.type}_CLEARED`, entityType: "CorrectionsOverride", entityId: override.id, details: { facilityId: override.facilityId, zoneIds: override.targetZoneIds, endedAt: endedAt.toISOString(), restoration: "RE_RESOLVE_CURRENT_PRIVATE_PROGRAMMING" } } });
    await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "INFO", title: `${override.type === "EMERGENCY" ? "Emergency" : "Priority"} Inside override cleared`, message: "Players will return to the current approved private schedule on their next signed-manifest refresh.", entityType: "CorrectionsOverride", entityId: override.id, dedupeKey: `inside-override-clear:${override.id}`, correlationId: override.id });
    return { override: saved };
  });
}

// A player can be offline throughout an override. Its time window still ends
// authoritatively, without treating missing playback proof as completion.
export async function reconcileExpiredCorrectionsOverrides(organisationId, facilityId, instant = new Date()) {
  const expired = await prisma.correctionsOverride.findMany({ where: { organisationId, facilityId, status: "ACTIVE", expiresAt: { lte: instant } }, select: { id: true }, take: 50 });
  for (const item of expired) {
    await runSerializableTransaction(prisma, async (tx) => {
      const changed = await tx.correctionsOverride.updateMany({ where: { id: item.id, organisationId, facilityId, status: "ACTIVE", expiresAt: { lte: instant } }, data: { status: "EXPIRED", endedAt: instant } });
      if (!changed.count) return;
      await tx.playoutIntent.updateMany({ where: { correctionsOverrideId: item.id, cancelledAt: null }, data: { cancelledAt: instant } });
      const [targeted, completed] = await Promise.all([
        tx.playoutIntent.count({ where: { correctionsOverrideId: item.id } }),
        tx.proofOfPlayEvent.count({ where: { eventType: "COMPLETED", playoutIntent: { correctionsOverrideId: item.id } } })
      ]);
      await tx.auditLog.create({ data: { organisationId, action: "CORRECTIONS_OVERRIDE_EXPIRED", entityType: "CorrectionsOverride", entityId: item.id, details: { facilityId, targeted, completed, endedAt: instant.toISOString(), restoration: "RE_RESOLVE_CURRENT_PRIVATE_PROGRAMMING" } } });
      if (completed < targeted) await enqueueNotificationEvent(tx, { organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "WARNING", title: "Inside override ended without full delivery proof", message: `${completed} of ${targeted} targeted players confirmed complete playback.`, entityType: "CorrectionsOverride", entityId: item.id, dedupeKey: `inside-override-expired:${item.id}`, correlationId: item.id });
    });
  }
}

export async function listCorrectionsAnnouncementWorkspace(access, facilityId) {
  const { member, grant, facility, tier } = await authority(prisma, access, facilityId, "READ");
  await reconcileExpiredCorrectionsOverrides(access.organisationId, facilityId);
  const [announcements, overrides, media] = await Promise.all([
    prisma.correctionsAnnouncement.findMany({ where: { organisationId: access.organisationId, facilityId }, orderBy: { createdAt: "desc" }, take: 100, include: { playoutIntents: { select: { plannedStart: true, expiresAt: true, playbackEvents: { where: { eventType: { in: ["COMPLETED", "FAILED"] } }, select: { eventType: true, playerId: true } } } } } }),
    prisma.correctionsOverride.findMany({ where: { organisationId: access.organisationId, facilityId }, orderBy: { startedAt: "desc" }, take: 30, include: { playoutIntents: { include: { player: { select: { name: true, status: true, lastHeartbeatAt: true } }, playbackEvents: { select: { eventType: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 5 } } } } }),
    prisma.promoVersion.findMany({ where: { status: "APPROVED", qcStatus: "PASSED", promoAsset: { organisationId: access.organisationId, status: "ACTIVE", mediaType: { in: ["ANNOUNCEMENT", "VOICEOVER"] } }, mediaAsset: { organisationId: access.organisationId, ...managedAudio } }, select: { id: true, checksumSha256: true, mediaAssetId: true, promoAsset: { select: { name: true, currentApprovedVersionId: true } }, mediaAsset: { select: { durationSeconds: true } } }, take: 100 })
  ]);
  return { announcements, overrides, media: media.filter((item) => item.promoAsset.currentApprovedVersionId === item.id && /^[0-9a-f]{64}$/i.test(item.checksumSha256 || "")), now: new Date(),
    permissions: Object.fromEntries(["CREATE", "APPROVE", "SCHEDULE", "PRIORITY_ACTIVATE", "PRIORITY_STOP", "EMERGENCY_ACTIVATE", "EMERGENCY_CLEAR"].map((action) => [action, correctionsAnnouncementPermission({ role: member.role, grant, action, facility, tier })])) };
}
