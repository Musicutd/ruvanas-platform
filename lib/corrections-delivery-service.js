import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { correctionsC5Features, correctionsRequestAllowed } from "@/lib/corrections-c5-policy.mjs";
import { correctionsMusicEligibility } from "@/lib/corrections-policy.mjs";
import { correctionsSchedulingGate } from "@/lib/corrections-workflow.mjs";
import { correctionsStudioSourcesAvailable } from "@/lib/corrections-studio-source-service";
import { assertEligibleTrack } from "@/lib/corrections-requests-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { chooseCorrectionsOverride } from "@/lib/corrections-c6-policy.mjs";
import { reconcileExpiredCorrectionsOverrides } from "@/lib/corrections-announcements-service";

function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }
function hash(parts) { return createHash("sha256").update(parts.join(":"), "utf8").digest("hex"); }
const renderInclude = { outputMediaAsset: true, outputPromoVersion: true, version: { select: { state: true } }, project: { select: { organisationId: true, createdByUserId: true, currentVersion: true, title: true } } };

function scheduleTime(value, now = new Date()) {
  const startsAt = new Date(value);
  if (!value || Number.isNaN(startsAt.getTime()) || startsAt.getTime() < now.getTime() + 5 * 60_000 || startsAt.getTime() > now.getTime() + 30 * 86_400_000) {
    throw bad("Choose a time at least five minutes from now and within 30 days.");
  }
  return startsAt;
}

async function authority(tx, access, facilityId) {
  const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id }, select: { id: true, userId: true, organisationId: true, role: true } });
  if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId) throw bad("Your organisation access changed.", 403);
  if (member.role !== "OWNER") {
    const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId } } });
    if (member.role !== "MANAGER" || grant?.organisationId !== access.organisationId || grant.permission !== "MANAGER") throw bad("Only authorised facility staff may schedule Inside audio.", 403);
  }
  const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
  const entitlements = resolveEntitlements(subscription);
  if (!entitlements.correctionsRadioEnabled) throw bad("Ruvanas Inside is not active.", 403);
  return { member, entitlements, features: correctionsC5Features(entitlements) };
}

async function target(tx, organisationId, facilityId, zoneId, startsAt) {
  const facility = await tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId, status: "ACTIVE" } }, include: { location: { select: { id: true, name: true, timezone: true, countryCode: true, organisationId: true } } } });
  const zone = await tx.zone.findFirst({ where: { id: zoneId, locationId: facilityId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!facility || !zone || !facility.location.countryCode || !facility.policyConfiguredAt) throw bad("Choose an active, policy-configured facility and zone.", 409);
  const assignment = await tx.channelAssignment.findFirst({ where: { zoneId, activeFrom: { lte: startsAt }, OR: [{ activeTo: null }, { activeTo: { gt: startsAt } }], channel: { organisationId, status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO", station: { productFamily: "CORRECTIONS" } } }, select: { channelId: true, activeTo: true } });
  if (!assignment) throw bad("This zone needs an active private Inside channel before scheduling.", 409);
  const players = await tx.player.findMany({ where: { organisationId, zoneId, status: { in: ["ONLINE", "OFFLINE"] }, sessionTokenHash: { not: null }, retiredAt: null }, select: { id: true } });
  if (!players.length) throw bad("Enrol a private player in this zone before scheduling.", 409);
  return { facility, zone, channelId: assignment.channelId, channelAssignmentEndsAt: assignment.activeTo, players };
}

async function approvedProgramme(tx, organisationId, facilityId, programmeId) {
  const programme = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId, facilityId, status: "APPROVED" } });
  if (!programme) throw bad("Choose an approved programme for this facility.", 409);
  const submission = await tx.correctionsSubmission.findUnique({ where: { programmeId_revision: { programmeId, revision: programme.latestRevision } }, include: { reviews: true } });
  const [organisationPolicy, facilityPolicy, render] = await Promise.all([
    tx.correctionsProfile.findUnique({ where: { organisationId } }),
    tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId, status: "ACTIVE" } }, include: { location: { select: { countryCode: true, organisationId: true } } } }),
    submission ? tx.audioRender.findFirst({ where: { id: submission.renderId, organisationId }, include: renderInclude }) : null
  ]);
  const gate = correctionsSchedulingGate({ programme, submission, reviews: submission?.reviews || [], organisationPolicy, facilityPolicy, render });
  if (!gate.allowed) throw bad(`Corrections Guard blocked this programme: ${gate.reason}.`, 409);
  if (submission.studioSessionId && !await correctionsStudioSourcesAvailable(tx, { organisationId, projectId: submission.studioProjectId, versionState: render.version.state })) throw bad("A supervised Studio source is no longer approved.", 409);
  if (render.outputMediaAsset?.status !== "READY") throw bad("The programme audio is no longer available.", 409);
  return { programme, submission, render, organisationPolicy, facilityPolicy };
}

function intentData({ organisationId, targetScope, playerId, startsAt, expiresAt, mediaAssetId, promoVersionId = null, trackId = null, programme, submission, requestId = null, rehabContentId = null }) {
  return {
    scheduleItemId: hash(["inside-c51", requestId || rehabContentId, programme.id, submission.id, targetScope.zone.id, playerId, startsAt.toISOString()]),
    organisationId, playerId, zoneId: targetScope.zone.id, channelId: targetScope.channelId,
    locationId: targetScope.facility.locationId, locationName: targetScope.facility.location.name,
    locationTimezone: targetScope.facility.location.timezone, locationGroups: [],
    publicationRevision: submission.revision, sourceRevision: `${submission.id}:${submission.sourceFingerprint}`,
    mediaAssetId, promoVersionId, plannedStart: startsAt, expiresAt,
    correctionsRequestId: requestId, correctionsRehabContentId: rehabContentId,
    correctionsProgrammeId: programme.id, correctionsSubmissionId: submission.id, correctionsTrackId: trackId
  };
}

async function noOverlap(tx, playerIds, startsAt, expiresAt) {
  const overlapping = await tx.playoutIntent.count({ where: { playerId: { in: playerIds }, cancelledAt: null, plannedStart: { lt: expiresAt }, expiresAt: { gt: startsAt } } });
  if (overlapping) throw bad("Another Inside delivery already occupies this player and time window.", 409);
}

export async function scheduleCorrectionsRequest(access, requestId, input) {
  const startsAt = scheduleTime(input.startsAt);
  const zoneId = String(input.zoneId || "");
  return runSerializableTransaction(prisma, async (tx) => {
    const request = await tx.correctionsRequest.findFirst({ where: { id: requestId, organisationId: access.organisationId } });
    if (!request) throw bad("Request not found.", 404);
    const { entitlements, features } = await authority(tx, access, request.facilityId);
    if (!features.internalRequests || (request.source === "FAMILY" && !features.familyRequests)) throw bad("Requests are no longer included in this plan.", 403);
    if (request.status === "SCHEDULED" || request.status === "PLAYED") {
      const existing = await tx.playoutIntent.findFirst({ where: { correctionsRequestId: request.id, cancelledAt: null }, select: { plannedStart: true, zoneId: true, correctionsProgrammeId: true } });
      if (existing && existing.plannedStart.getTime() === startsAt.getTime() && existing.zoneId === zoneId && existing.correctionsProgrammeId === String(input.programmeId || request.programmeId || "")) return { status: request.status, startsAt: existing.plannedStart, zoneId, alreadyScheduled: true };
      throw bad("This request already has a delivery plan.", 409);
    }
    if (request.status !== "APPROVED") throw bad("Only an approved request can be scheduled.", 409);
    const targetScope = await target(tx, access.organisationId, request.facilityId, zoneId, startsAt);
    if (!correctionsRequestAllowed(targetScope.facility, request.source, request.type)) throw bad("Facility policy no longer permits this request.", 409);
    const programmeId = String(input.programmeId || request.programmeId || "");
    if (request.programmeId && request.programmeId !== programmeId) throw bad("This request was approved for a different programme.", 409);
    const approved = await approvedProgramme(tx, access.organisationId, request.facilityId, programmeId);
    let trackId = null;
    let mediaAssetId = approved.render.outputMediaAsset.id;
    let promoVersionId = approved.render.outputPromoVersion?.id || null;
    let durationSeconds = Number(approved.render.outputMediaAsset.durationSeconds);
    if (request.type === "SONG") {
      const track = await assertEligibleTrack(tx, request, targetScope.facility, entitlements, request.trackId, startsAt);
      trackId = track.id; mediaAssetId = track.mediaAssetId; promoVersionId = null;
      durationSeconds = Number(track.mediaAsset.durationSeconds);
    } else if (["MESSAGE", "DEDICATION"].includes(request.type)) {
      const approval = await tx.correctionsRequestDecision.findFirst({ where: { requestId, action: "APPROVE" }, orderBy: { decidedAt: "desc" }, select: { decidedAt: true } });
      if (!approval || approved.submission.submittedAt <= approval.decidedAt || !request.onAirMessage) throw bad("Submit and approve a new programme render containing the moderated wording before scheduling this request.", 409);
    } else if (request.type !== "PROGRAMME") throw bad("Suggestions are for staff planning, not direct playout.", 409);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 2 || durationSeconds > 14_400) throw bad("The approved audio duration is not valid.", 409);
    const expiresAt = new Date(startsAt.getTime() + (durationSeconds + 90) * 1000);
    if (targetScope.channelAssignmentEndsAt && targetScope.channelAssignmentEndsAt <= expiresAt) throw bad("The private channel assignment ends before this delivery window finishes.", 409);
    await noOverlap(tx, targetScope.players.map((player) => player.id), startsAt, expiresAt);
    await tx.playoutIntent.createMany({ data: targetScope.players.map((player) => intentData({ organisationId: access.organisationId, targetScope, playerId: player.id, startsAt, expiresAt, mediaAssetId, promoVersionId, trackId, programme: approved.programme, submission: approved.submission, requestId })) });
    await tx.correctionsRequest.update({ where: { id: requestId }, data: { status: "SCHEDULED" } });
    await tx.correctionsRequestDecision.create({ data: { requestId, organisationId: access.organisationId, facilityId: request.facilityId, action: "SCHEDULE", fromStatus: "APPROVED", toStatus: "SCHEDULED", moderatorUserId: access.context.user.id, programmeId, trackId } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_REQUEST_SCHEDULED", entityType: "CorrectionsRequest", entityId: requestId, details: { facilityId: request.facilityId, zoneId, channelId: targetScope.channelId, programmeId, submissionId: approved.submission.id, startsAt: startsAt.toISOString(), playerCount: targetScope.players.length } } });
    await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "INFO", title: "Inside request scheduled", message: "An approved radio request has a private player delivery plan.", entityType: "CorrectionsRequest", entityId: requestId, dedupeKey: `corrections-request-scheduled:${requestId}`, correlationId: requestId });
    return { status: "SCHEDULED", startsAt, zoneId, playerCount: targetScope.players.length };
  });
}

export async function scheduleCorrectionsRehabilitation(access, contentId, input) {
  const startsAt = scheduleTime(input.startsAt);
  const zoneId = String(input.zoneId || "");
  const programmeId = String(input.programmeId || "");
  return runSerializableTransaction(prisma, async (tx) => {
    const content = await tx.correctionsRehabContent.findFirst({ where: { id: contentId, organisationId: access.organisationId, status: "APPROVED" } });
    if (!content) throw bad("Choose approved rehabilitation content.", 409);
    const facilityId = content.facilityId || String(input.facilityId || "");
    const { features } = await authority(tx, access, facilityId);
    if (!features.rehabilitationManagement || (content.facilityId && content.facilityId !== facilityId)) throw bad("This content is unavailable for the facility.", 403);
    const approved = await approvedProgramme(tx, access.organisationId, facilityId, programmeId);
    if (!await tx.correctionsRehabProgrammeItem.findFirst({ where: { programmeId, contentId } })) throw bad("Attach the approved content to this programme before scheduling.", 409);
    if (content.expiresAt && content.expiresAt <= startsAt) throw bad("Content approval expires before the scheduled play.", 409);
    const media = await tx.mediaAsset.findFirst({ where: { id: content.mediaAssetId, organisationId: access.organisationId, status: "READY", libraryType: "ORGANISATION_PROMO", promoVersions: { some: { status: "APPROVED", qcStatus: "PASSED" } } }, include: { promoVersions: { where: { status: "APPROVED", qcStatus: "PASSED" }, orderBy: { version: "desc" }, take: 1 } } });
    if (!media || !media.promoVersions[0]) throw bad("The rehabilitation audio is no longer approved.", 409);
    const targetScope = await target(tx, access.organisationId, facilityId, zoneId, startsAt);
    const durationSeconds = Number(media.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 2 || durationSeconds > 14_400) throw bad("The approved audio duration is not valid.", 409);
    const expiresAt = new Date(startsAt.getTime() + (durationSeconds + 90) * 1000);
    if (targetScope.channelAssignmentEndsAt && targetScope.channelAssignmentEndsAt <= expiresAt) throw bad("The private channel assignment ends before this delivery window finishes.", 409);
    const existing = await tx.playoutIntent.findFirst({ where: { correctionsRehabContentId: contentId, correctionsProgrammeId: programmeId, zoneId, plannedStart: startsAt, cancelledAt: null } });
    if (existing) return { startsAt, zoneId, programmeId, alreadyScheduled: true };
    await noOverlap(tx, targetScope.players.map((player) => player.id), startsAt, expiresAt);
    await tx.playoutIntent.createMany({ data: targetScope.players.map((player) => intentData({ organisationId: access.organisationId, targetScope, playerId: player.id, startsAt, expiresAt, mediaAssetId: media.id, promoVersionId: media.promoVersions[0].id, programme: approved.programme, submission: approved.submission, rehabContentId: contentId })) });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_REHAB_SCHEDULED", entityType: "CorrectionsRehabContent", entityId: contentId, details: { facilityId, zoneId, channelId: targetScope.channelId, programmeId, submissionId: approved.submission.id, startsAt: startsAt.toISOString(), playerCount: targetScope.players.length } } });
    return { startsAt, zoneId, programmeId, playerCount: targetScope.players.length };
  });
}

// The shared player consumes these existing PlayoutIntent rows. Revalidate at
// manifest time so a withdrawn approval, changed policy, or expired right does
// not become playable merely because staff scheduled it earlier.
export async function correctionsPlayerInsertions(player, instant = new Date()) {
  const facility = await prisma.correctionsFacility.findFirst({ where: { locationId: player.zone.locationId, location: { organisationId: player.organisationId } }, select: { locationId: true } });
  if (!facility) return { privateFacility: false, insertions: [] };
  try { await reconcileExpiredCorrectionsOverrides(player.organisationId, facility.locationId, instant); }
  catch (error) { console.error("Inside override expiry reconciliation failed", { facilityId: facility.locationId, error }); }
  const subscription = player.organisation?.subscription;
  const currentEntitlements = resolveEntitlements(subscription);
  if (!currentEntitlements.correctionsRadioEnabled) return { privateFacility: true, insertions: [] };
  const features = correctionsC5Features(currentEntitlements);
  const intents = await prisma.playoutIntent.findMany({ where: { organisationId: player.organisationId, playerId: player.id, zoneId: player.zoneId, cancelledAt: null, OR: [{ correctionsRequestId: { not: null } }, { correctionsRehabContentId: { not: null } }], plannedStart: { lte: new Date(instant.getTime() + 10 * 60_000) }, expiresAt: { gt: instant } }, orderBy: { plannedStart: "asc" }, take: 10, include: { correctionsRequest: true, correctionsRehabContent: true, correctionsProgramme: true, correctionsSubmission: { include: { reviews: true } }, correctionsTrack: { include: { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }, distributorItems: { include: { canonicalGenre: true } } } }, mediaAsset: { include: { promoVersions: true } } } });
  const insertions = [];
  for (const intent of intents) {
    try {
      const current = await approvedProgramme(prisma, player.organisationId, facility.locationId, intent.correctionsProgrammeId);
      if (current.submission.id !== intent.correctionsSubmissionId || intent.sourceRevision !== `${current.submission.id}:${current.submission.sourceFingerprint}` || intent.channelId !== player.zone.channelAssignments[0]?.channelId) continue;
      const scoped = await prisma.correctionsFacility.findFirst({ where: { locationId: facility.locationId }, include: { location: { select: { organisationId: true, countryCode: true } } } });
      if (intent.correctionsRequestId) {
        const request = intent.correctionsRequest;
        if (!features.internalRequests || (request?.source === "FAMILY" && !features.familyRequests) || !request || !["SCHEDULED", "PLAYED"].includes(request.status) || request.organisationId !== player.organisationId || request.facilityId !== facility.locationId || !correctionsRequestAllowed(scoped, request.source, request.type)) continue;
        if (request.type === "SONG") {
          const configuredGenres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } });
          const eligibility = correctionsMusicEligibility(intent.correctionsTrack, { organisationId: player.organisationId, facility: scoped, organisationPolicy: current.organisationPolicy, facilityPolicy: scoped, licensedCatalogueLevel: currentEntitlements.licensedMusicCatalogueLevel, configuredGenres, instant });
          if (!eligibility.playable || request.trackId !== intent.correctionsTrackId || intent.mediaAssetId !== intent.correctionsTrack.mediaAssetId) continue;
        } else if (intent.mediaAssetId !== current.render.outputMediaAsset.id || intent.promoVersionId !== current.render.outputPromoVersion?.id) continue;
      } else {
        if (!features.rehabilitationManagement) continue;
        const content = intent.correctionsRehabContent;
        if (!content || content.status !== "APPROVED" || content.organisationId !== player.organisationId || (content.facilityId && content.facilityId !== facility.locationId) || (content.expiresAt && content.expiresAt <= instant) || content.mediaAssetId !== intent.mediaAssetId || !intent.mediaAsset?.promoVersions?.some((version) => version.id === intent.promoVersionId && version.status === "APPROVED" && version.qcStatus === "PASSED") || intent.mediaAsset.status !== "READY") continue;
        if (!await prisma.correctionsRehabProgrammeItem.findFirst({ where: { programmeId: current.programme.id, contentId: content.id } })) continue;
      }
      const song = Boolean(intent.correctionsTrackId);
      insertions.push({ scheduleItemId: intent.scheduleItemId, itemType: song ? "MUSIC" : "CORRECTIONS_AUDIO", trackId: intent.correctionsTrackId, mediaAssetId: intent.mediaAssetId, promoVersionId: intent.promoVersionId, plannedStart: intent.plannedStart, durationSeconds: Number(intent.mediaAsset.durationSeconds), sourceRevision: intent.sourceRevision, title: song ? intent.correctionsTrack.title : intent.correctionsRehabContent?.title || "Approved Inside programme", artist: song ? intent.correctionsTrack.artist : "Ruvanas Inside", programmingSource: intent.correctionsRequestId ? "CORRECTIONS_REQUEST" : "CORRECTIONS_REHABILITATION" });
    } catch { /* fail closed if an approval or source was withdrawn */ }
  }
  // C6 uses the same signed manifest and PlayoutIntent proof path. The server
  // chooses one authoritative override per zone before ordinary deliveries.
  const overrides = await prisma.correctionsOverride.findMany({ where: { organisationId: player.organisationId, facilityId: facility.locationId, status: "ACTIVE", startedAt: { lte: instant }, expiresAt: { gt: instant }, targetZoneIds: { has: player.zoneId }, targetPlayerIds: { has: player.id } } });
  let override = chooseCorrectionsOverride(overrides, player.zoneId, instant);
  const c6Where = (overrideId) => ({ organisationId: player.organisationId, playerId: player.id, zoneId: player.zoneId, correctionsAnnouncementId: { not: null }, correctionsOverrideId: overrideId, cancelledAt: null, plannedStart: { lte: new Date(instant.getTime() + (overrideId ? 0 : 10 * 60_000)) }, expiresAt: { gt: instant } });
  const c6Include = { correctionsAnnouncement: true, promoVersion: { include: { promoAsset: true } }, mediaAsset: true, playbackEvents: { where: { eventType: { in: ["COMPLETED", "FAILED"] } }, select: { eventType: true }, take: 1 } };
  let c6Intents = await prisma.playoutIntent.findMany({ where: c6Where(override?.id || null), include: c6Include, orderBy: { plannedStart: "asc" }, take: 10 });
  // A completed or failed target returns to the current approved private
  // schedule even while other zones still await their own delivery proof.
  if (override && c6Intents.length && c6Intents.every((intent) => intent.playbackEvents.length)) {
    override = null;
    c6Intents = await prisma.playoutIntent.findMany({ where: c6Where(null), include: c6Include, orderBy: { plannedStart: "asc" }, take: 10 });
  }
  const announcements = c6Intents.filter((intent) => {
    const announcement = intent.correctionsAnnouncement;
    const promo = intent.promoVersion;
    return !intent.playbackEvents.length && announcement?.status === "APPROVED" && announcement.organisationId === player.organisationId && announcement.facilityId === facility.locationId &&
      announcement.mediaAssetId === intent.mediaAssetId && announcement.promoVersionId === intent.promoVersionId &&
      promo?.status === "APPROVED" && promo.qcStatus === "PASSED" && promo.mediaAssetId === intent.mediaAssetId && promo.promoAsset?.organisationId === player.organisationId && promo.promoAsset?.currentApprovedVersionId === promo.id &&
      intent.mediaAsset?.organisationId === player.organisationId && intent.mediaAsset.status === "READY" && intent.channelId === player.zone.channelAssignments[0]?.channelId &&
      intent.sourceRevision === `${announcement.id}:${promo.id}:${promo.checksumSha256}`;
  }).map((intent) => ({ scheduleItemId: intent.scheduleItemId, itemType: "CORRECTIONS_AUDIO", mediaAssetId: intent.mediaAssetId, promoVersionId: intent.promoVersionId, plannedStart: intent.plannedStart, expiresAt: intent.expiresAt, durationSeconds: Number(intent.mediaAsset.durationSeconds), sourceRevision: intent.sourceRevision, title: intent.correctionsAnnouncement.title, artist: "Ruvanas Inside", programmingSource: override ? `CORRECTIONS_${override.type}` : "CORRECTIONS_STANDARD", overrideId: override?.id || null, overrideType: override?.type || null }));
  return { privateFacility: true, insertions: override ? announcements : [...insertions, ...announcements], activeOverride: override ? { id: override.id, type: override.type, expiresAt: override.expiresAt } : null };
}

export async function requestDeliveryDetails(organisationId, requestIds) {
  if (!requestIds.length) return new Map();
  const intents = await prisma.playoutIntent.findMany({ where: { organisationId, correctionsRequestId: { in: requestIds }, cancelledAt: null }, select: { correctionsRequestId: true, zoneId: true, plannedStart: true, expiresAt: true, channelId: true, playbackEvents: { where: { eventType: { in: ["COMPLETED", "FAILED", "INTERRUPTED"] } }, orderBy: { occurredAt: "asc" }, select: { id: true, eventType: true, occurredAt: true, playerName: true, zoneName: true } } }, orderBy: { plannedStart: "desc" } });
  const result = new Map();
  for (const intent of intents) {
    const existing = result.get(intent.correctionsRequestId);
    const completed = intent.playbackEvents.find((event) => event.eventType === "COMPLETED");
    if (!existing || (completed && !existing.evidence)) result.set(intent.correctionsRequestId, { startsAt: intent.plannedStart, zoneId: intent.zoneId, channelId: intent.channelId, evidence: completed || null, needsAttention: !completed && intent.expiresAt < new Date() });
  }
  return result;
}

export async function rehabilitationDeliveryDetails(organisationId, contentIds) {
  if (!contentIds.length) return new Map();
  const intents = await prisma.playoutIntent.findMany({ where: { organisationId, correctionsRehabContentId: { in: contentIds }, cancelledAt: null }, select: { correctionsRehabContentId: true, correctionsProgrammeId: true, zoneId: true, channelId: true, locationId: true, plannedStart: true, expiresAt: true, mediaAsset: { select: { durationSeconds: true } }, playbackEvents: { where: { eventType: "COMPLETED" }, select: { id: true, occurredAt: true, positionSeconds: true, playerName: true, zoneName: true } } } });
  const result = new Map();
  for (const intent of intents) {
    const item = result.get(intent.correctionsRehabContentId) || { scheduled: 0, delivered: 0, deliveredSeconds: 0, deliveryEvents: [] };
    item.scheduled += 1;
    for (const event of intent.playbackEvents) { item.delivered += 1; item.deliveredSeconds += Number(intent.mediaAsset.durationSeconds) || 0; item.deliveryEvents.push({ ...event, programmeId: intent.correctionsProgrammeId, facilityId: intent.locationId, zoneId: intent.zoneId, channelId: intent.channelId }); }
    result.set(intent.correctionsRehabContentId, item);
  }
  return result;
}
