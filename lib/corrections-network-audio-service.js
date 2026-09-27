import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { correctionsNetworkAuthority } from "@/lib/corrections-network-service";
import { correctionsNetworkSourcePolicy } from "@/lib/corrections-network-source-policy.mjs";
import { resolveCorrectionsDistributionTargets } from "@/lib/corrections-network-policy.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const validKinds = new Set(["REHABILITATION", "ANNOUNCEMENT"]);
const digest = (parts) => createHash("sha256").update(parts.join(":"), "utf8").digest("hex");

// A C5/C6 source is reviewed before distribution, but distribution is not
// approval. The exact media and PromoVersion are pinned and checked again at
// both schedule time and playback time; a later edit cannot retarget them.
export async function approvedCorrectionsNetworkAudioSource(tx, organisationId, kind, contentId,
  { pinnedVersionId = null, instant = new Date() } = {}) {
  if (!validKinds.has(kind)) throw bad("Choose rehabilitation or a standard announcement.");
  const content = kind === "REHABILITATION"
    ? await tx.correctionsRehabContent.findFirst({ where: { id: contentId, organisationId, status: "APPROVED" } })
    : await tx.correctionsAnnouncement.findFirst({ where: { id: contentId, organisationId, status: "APPROVED" } });
  if (!content || (kind === "REHABILITATION" && content.expiresAt && content.expiresAt <= instant)) {
    throw bad("Choose current, staff-approved Inside content.", 409);
  }
  const media = await tx.mediaAsset.findFirst({ where: { id: content.mediaAssetId, organisationId,
    libraryType: "ORGANISATION_PROMO", status: "READY", mediaType: { in: ["ANNOUNCEMENT", "VOICEOVER", "JINGLE"] } },
    include: { genres: { select: { mediaGenre: { select: { slug: true, name: true } } } } } });
  if (!media || !Number.isFinite(Number(media.durationSeconds)) || Number(media.durationSeconds) < 2 ||
      Number(media.durationSeconds) > 14_400) {
    throw bad("This authority-owned audio is unavailable.", 409);
  }
  const promoCandidates = await tx.promoVersion.findMany({ where: { id: pinnedVersionId || (kind === "ANNOUNCEMENT" ? content.promoVersionId : undefined),
    mediaAssetId: media.id, status: "APPROVED", qcStatus: "PASSED", promoAsset: { organisationId, status: "ACTIVE" } },
    include: { promoAsset: { select: { currentApprovedVersionId: true, organisationId: true, status: true } } },
    orderBy: { version: "desc" } });
  const promo = pinnedVersionId ? promoCandidates[0]
    : promoCandidates.find((candidate) => candidate.promoAsset.currentApprovedVersionId === candidate.id);
  if (!promo || (kind === "ANNOUNCEMENT" && promo.id !== content.promoVersionId) ||
      (pinnedVersionId && promo.id !== pinnedVersionId) || !/^[a-f0-9]{64}$/i.test(promo.checksumSha256 || "")) {
    throw bad("The checksum-verified approved audio version is unavailable.", 409);
  }
  const organisationPolicy = await tx.correctionsProfile.findUnique({ where: { organisationId } });
  if (!organisationPolicy?.policyConfiguredAt) throw bad("The central Corrections policy is not configured.", 409);
  const sourceFacility = content.facilityId ? await tx.correctionsFacility.findFirst({ where: { locationId: content.facilityId,
    location: { organisationId, status: "ACTIVE" } }, include: { location: { select: { organisationId: true, status: true, countryCode: true } } } }) : null;
  if (content.facilityId && (!sourceFacility?.policyConfiguredAt || !sourceFacility.location.countryCode)) {
    throw bad("The source facility lacks an active Corrections policy and territory.", 409);
  }
  const source = { kind, content, media, promo, organisationPolicy, sourceFacility,
    fingerprint: digest([kind, content.id, media.id, promo.id, promo.checksumSha256]),
    territory: sourceFacility?.location.countryCode || null };
  // An origin facility may later tighten its own playback policy. That must
  // block playback there, not silently revoke a separately approved recipient
  // facility's distribution. Recipient policy is checked on every use.
  return source;
}

export function assertCorrectionsNetworkAudioTarget(organisationId, source, facility, territoryCode) {
  if (facility?.location?.organisationId !== organisationId || facility.location.status !== "ACTIVE" ||
      !facility.policyConfiguredAt || facility.location.countryCode !== territoryCode ||
      (source.territory && source.territory !== territoryCode)) {
    throw bad("Target facility policy, ownership or territory is not eligible for this audio.", 409);
  }
  const policy = correctionsNetworkSourcePolicy({ sourceMedia: [source.media], outputMediaAssetId: source.media.id,
    organisationPolicy: source.organisationPolicy, facilityPolicy: facility });
  if (!policy.allowed) throw bad(`Target Corrections policy blocked this audio: ${policy.reason}.`, 409);
  return facility;
}

export async function createCorrectionsNetworkAudioDistribution(access, input) {
  const kind = String(input.kind || "").toUpperCase();
  const contentId = String(input.contentId || "");
  const groupId = input.groupId ? String(input.groupId) : null;
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
  if (!validKinds.has(kind) || !contentId) throw bad("Choose approved rehabilitation or standard announcement audio.");
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveUntil && (Number.isNaN(effectiveUntil.getTime()) || effectiveUntil <= effectiveFrom))) {
    throw bad("Choose a valid distribution period.");
  }
  return runSerializableTransaction(prisma, async (tx) => {
    await correctionsNetworkAuthority(tx, access, "distribute");
    const source = await approvedCorrectionsNetworkAudioSource(tx, access.organisationId, kind, contentId);
    const group = groupId ? await tx.locationGroup.findFirst({ where: { id: groupId, organisationId: access.organisationId },
      select: { id: true, name: true, locations: { select: { locationId: true } } } }) : null;
    if (groupId && !group) throw bad("The facility group is outside this authority.", 404);
    const facilities = await tx.correctionsFacility.findMany({ where: { location: { organisationId: access.organisationId, status: "ACTIVE" } },
      include: { location: { select: { id: true, organisationId: true, status: true, countryCode: true } } } });
    const ids = resolveCorrectionsDistributionTargets({ allFacilities: facilities.map((facility) => ({ id: facility.locationId,
      active: Boolean(facility.policyConfiguredAt && facility.location.countryCode) })),
      selectedIds: Array.isArray(input.facilityIds) ? input.facilityIds : [], groupMembers: group?.locations.map((item) => item.locationId) || [],
      includeAll: input.allFacilities === true });
    // Authority-wide rehabilitation content has no originating facility. A
    // central staff member must declare one country and confirm media rights;
    // mixed-territory distribution is deliberately rejected.
    const territoryCode = source.territory || String(input.territoryCode || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(territoryCode) || input.rightsConfirmed !== true) {
      throw bad("Confirm the rights territory for authority-level rehabilitation audio.", 409);
    }
    for (const id of ids) assertCorrectionsNetworkAudioTarget(access.organisationId, source,
      facilities.find((facility) => facility.locationId === id), territoryCode);
    const contentField = kind === "REHABILITATION" ? "rehabilitationId" : "announcementId";
    if (await tx.correctionsNetworkAudioDistribution.count({ where: { [contentField]: contentId,
      promoVersionId: source.promo.id, targetFacilityId: { in: ids } } })) {
      throw bad("This exact approved audio version was already distributed to one or more selected facilities.", 409);
    }
    const groupMembers = new Set(group?.locations.map((item) => item.locationId) || []);
    const rows = [];
    for (const targetFacilityId of ids) rows.push(await tx.correctionsNetworkAudioDistribution.create({ data: {
      organisationId: access.organisationId, sourceFacilityId: source.content.facilityId || null, targetFacilityId, kind,
      targetGroupId: groupMembers.has(targetFacilityId) ? group.id : null,
      targetGroupName: groupMembers.has(targetFacilityId) ? group.name : null,
      [contentField]: contentId, mediaAssetId: source.media.id, promoVersionId: source.promo.id,
      sourceFingerprint: source.fingerprint, territoryCode, effectiveFrom, effectiveUntil,
      createdByUserId: access.context.user.id
    }, select: { id: true, targetFacilityId: true } }));
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_AUDIO_DISTRIBUTED", entityType: kind === "REHABILITATION" ? "CorrectionsRehabContent" : "CorrectionsAnnouncement",
      entityId: contentId, details: { kind, targetFacilityIds: ids,
        targetGroupId: group?.id || null, targetGroupName: group?.name || null, sourceFingerprint: source.fingerprint,
        promoVersionId: source.promo.id, territoryCode, rightsConfirmed: input.rightsConfirmed === true,
        effectiveFrom: effectiveFrom.toISOString(), effectiveUntil: effectiveUntil?.toISOString() || null } } });
    return { distributionIds: rows.map((row) => row.id), targetFacilityIds: ids, sourceFingerprint: source.fingerprint };
  });
}

export async function withdrawCorrectionsNetworkAudioDistribution(access, distributionId) {
  return runSerializableTransaction(prisma, async (tx) => {
    await correctionsNetworkAuthority(tx, access, "distribute");
    const distribution = await tx.correctionsNetworkAudioDistribution.findFirst({ where: { id: distributionId,
      organisationId: access.organisationId } });
    if (!distribution) throw bad("Audio distribution not found.", 404);
    if (distribution.status === "WITHDRAWN") return { id: distribution.id, status: distribution.status };
    const now = new Date();
    const windows = await tx.correctionsNetworkWindow.findMany({ where: { organisationId: access.organisationId,
      audioDistributionId: distribution.id }, select: { id: true } });
    await tx.correctionsNetworkAudioDistribution.update({ where: { id: distribution.id }, data: { status: "WITHDRAWN", withdrawnAt: now } });
    await tx.correctionsNetworkWindow.updateMany({ where: { organisationId: access.organisationId,
      audioDistributionId: distribution.id, active: true }, data: { active: false } });
    let cancelledIntents = 0;
    for (const window of windows) {
      const cancelled = await tx.playoutIntent.updateMany({ where: { organisationId: access.organisationId,
        locationId: distribution.targetFacilityId, sourceRevision: { startsWith: `c7a:${window.id}:${distribution.id}:` },
        cancelledAt: null, expiresAt: { gt: now } }, data: { cancelledAt: now } });
      cancelledIntents += cancelled.count;
    }
    await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "WARNING",
      title: "Inside network audio withdrawn", message: "A private network distribution was withdrawn. Review the affected facility schedule.",
      entityType: "CorrectionsNetworkAudioDistribution", entityId: distribution.id,
      dedupeKey: `corrections-network-audio-withdrawn:${distribution.id}`, correlationId: distribution.id });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_AUDIO_WITHDRAWN", entityType: "CorrectionsNetworkAudioDistribution", entityId: distribution.id,
      details: { kind: distribution.kind, targetFacilityId: distribution.targetFacilityId,
        sourceFingerprint: distribution.sourceFingerprint, futureWindowsDisabled: true, cancelledIntents } } });
    return { id: distribution.id, status: "WITHDRAWN" };
  });
}
