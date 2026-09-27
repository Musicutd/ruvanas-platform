import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { correctionsSchedulingGate } from "@/lib/corrections-workflow.mjs";
import { correctionsStudioSourceIds } from "@/lib/corrections-studio-sources.mjs";
import { correctionsStudioSourcesCurrent } from "@/lib/corrections-studio-sources.mjs";
import { correctionsNetworkAuthority } from "@/lib/corrections-network-service";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { correctionsWindowConflict, normalizeCorrectionsNetworkWindow, resolveCorrectionsDistributionTargets } from "@/lib/corrections-network-policy.mjs";
import { correctionsNetworkSourcePolicy } from "@/lib/corrections-network-source-policy.mjs";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const renderInclude = { outputMediaAsset: true, outputPromoVersion: { include: { promoAsset: true } },
  version: { select: { state: true } }, project: { select: { organisationId: true } } };

export async function approvedCorrectionsNetworkSource(tx, organisationId, programmeId, pinnedSubmissionId = null) {
  const programme = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId, status: "APPROVED" } });
  if (!programme) throw bad("Choose an approved Inside programme owned by this authority.", 409);
  const submission = pinnedSubmissionId
    ? await tx.correctionsSubmission.findFirst({ where: { id: pinnedSubmissionId, programmeId, organisationId, status: "APPROVED" }, include: { reviews: true } })
    : await tx.correctionsSubmission.findUnique({ where: { programmeId_revision: { programmeId, revision: programme.latestRevision } }, include: { reviews: true } });
  const [organisationPolicy, facilityPolicy, render] = await Promise.all([
    tx.correctionsProfile.findUnique({ where: { organisationId } }),
    tx.correctionsFacility.findFirst({ where: { locationId: programme.facilityId, location: { organisationId, status: "ACTIVE" } }, include: { location: { select: { countryCode: true } } } }),
    submission ? tx.audioRender.findFirst({ where: { id: submission.renderId, organisationId }, include: renderInclude }) : null
  ]);
  // A distribution is an immutable, separately governed Corrections version.
  // Only this private path may review a previously approved pinned revision;
  // ordinary Studio handoff and facility scheduling still require latest.
  const gate = correctionsSchedulingGate({ programme: pinnedSubmissionId && submission ? { ...programme, latestRevision: submission.revision } : programme,
    submission, reviews: submission?.reviews || [], organisationPolicy, facilityPolicy, render });
  if (!gate.allowed || !facilityPolicy?.location.countryCode) throw bad(`Corrections Guard blocked distribution: ${gate.reason}.`, 409);
  if (render.outputMediaAsset?.status !== "READY" || render.outputMediaAsset.organisationId !== organisationId ||
      render.outputPromoVersion?.status !== "APPROVED" || render.outputPromoVersion.qcStatus !== "PASSED" ||
      render.outputPromoVersion.mediaAssetId !== render.outputMediaAsset.id ||
      render.outputPromoVersion.promoAsset?.organisationId !== organisationId ||
      render.outputPromoVersion.promoAsset.status !== "ACTIVE" ||
      (!pinnedSubmissionId && render.outputPromoVersion.promoAsset.currentApprovedVersionId !== render.outputPromoVersion.id)) throw bad("The approved audio version is unavailable.", 409);
  // Only organisation-owned Studio/voice sources may cross facility boundaries.
  // A licensed catalogue master or source with unknown provenance fails closed.
  const sourceIds = correctionsStudioSourceIds(render.version.state);
  const takes = sourceIds.length ? await tx.audioTake.findMany({ where: { organisationId, projectId: render.projectId, mediaAssetId: { in: sourceIds } },
    include: { mediaAsset: { select: { id: true, organisationId: true, status: true, libraryType: true, mediaType: true,
      genres: { select: { mediaGenre: { select: { slug: true, name: true } } } } } },
      promoVersion: { select: { id: true, status: true, qcStatus: true, promoAsset: { select: { status: true, currentApprovedVersionId: true } } } } } }) : [];
  if (!sourceIds.length || !correctionsStudioSourcesCurrent(sourceIds, takes, { requireCurrentVersion: !pinnedSubmissionId }) ||
      takes.some((take) => take.mediaAsset?.organisationId !== organisationId || take.mediaAsset.libraryType !== "ORGANISATION_PROMO")) {
    throw bad("Network distribution requires currently approved, authority-owned Studio sources.", 409);
  }
  return { programme, submission, render, territory: facilityPolicy.location.countryCode,
    organisationPolicy, sourceMedia: takes.map((take) => take.mediaAsset) };
}

export function assertCorrectionsNetworkTarget(organisationId, source, facility) {
  if (facility?.location?.organisationId !== organisationId || facility.location.status !== "ACTIVE" ||
      !facility.policyConfiguredAt || facility.location.countryCode !== source.territory) {
    throw bad("The target facility is inactive, outside this authority, or lacks matching rights and policy.", 409);
  }
  const result = correctionsNetworkSourcePolicy({ sourceMedia: source.sourceMedia,
    outputMediaAssetId: source.render.outputMediaAsset.id, organisationPolicy: source.organisationPolicy,
    facilityPolicy: facility });
  if (!result.allowed) throw bad(`Target Corrections policy blocked this version: ${result.reason}.`, 409);
  return facility;
}

export async function createCorrectionsDistribution(access, input) {
  const programmeId = String(input.programmeId || "");
  const groupId = input.groupId ? String(input.groupId) : null;
  const selectedIds = Array.isArray(input.facilityIds) ? input.facilityIds : [];
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveUntil && (Number.isNaN(effectiveUntil.getTime()) || effectiveUntil <= effectiveFrom))) throw bad("Choose a valid distribution period.");
  return runSerializableTransaction(prisma, async (tx) => {
    await correctionsNetworkAuthority(tx, access, "distribute");
    const source = await approvedCorrectionsNetworkSource(tx, access.organisationId, programmeId);
    const group = groupId ? await tx.locationGroup.findFirst({ where: { id: groupId, organisationId: access.organisationId },
      select: { locations: { select: { locationId: true } } } }) : null;
    if (groupId && !group) throw bad("The facility group is outside this authority.", 404);
    const all = await tx.correctionsFacility.findMany({ where: { location: { organisationId: access.organisationId, status: "ACTIVE" } },
      include: { location: { select: { id: true, organisationId: true, status: true, countryCode: true } } } });
    const ids = resolveCorrectionsDistributionTargets({ allFacilities: all.map((facility) => ({ id: facility.locationId, active: Boolean(facility.policyConfiguredAt && facility.location.countryCode) })),
      selectedIds, groupMembers: group?.locations.map((item) => item.locationId) || [], includeAll: input.allFacilities === true });
    for (const id of ids) {
      const facility = all.find((item) => item.locationId === id);
      assertCorrectionsNetworkTarget(access.organisationId, source, facility);
    }
    const existing = await tx.correctionsProgrammeDistribution.findMany({ where: { submissionId: source.submission.id, targetFacilityId: { in: ids } }, select: { targetFacilityId: true } });
    if (existing.length) throw bad("This exact programme version was already distributed to one or more selected facilities. Withdraw or select a new approved revision.", 409);
    const rows = await Promise.all(ids.map((targetFacilityId) => tx.correctionsProgrammeDistribution.create({ data: {
      organisationId: access.organisationId, sourceFacilityId: source.programme.facilityId, targetFacilityId,
      programmeId, submissionId: source.submission.id, effectiveFrom, effectiveUntil, createdByUserId: access.context.user.id
    }, select: { id: true, targetFacilityId: true } })));
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_DISTRIBUTED", entityType: "CorrectionsSubmission", entityId: source.submission.id,
      details: { programmeId, sourceFacilityId: source.programme.facilityId, targetFacilityIds: ids, revision: source.submission.revision,
        sourceFingerprint: source.submission.sourceFingerprint, effectiveFrom: effectiveFrom.toISOString(), effectiveUntil: effectiveUntil?.toISOString() || null } } });
    return { distributionIds: rows.map((row) => row.id), targetFacilityIds: ids, revision: source.submission.revision };
  });
}

export async function withdrawCorrectionsDistribution(access, distributionId) {
  return runSerializableTransaction(prisma, async (tx) => {
    await correctionsNetworkAuthority(tx, access, "distribute");
    const current = await tx.correctionsProgrammeDistribution.findFirst({ where: { id: distributionId, organisationId: access.organisationId } });
    if (!current) throw bad("Distribution not found.", 404);
    if (current.status === "WITHDRAWN") return { id: current.id, status: current.status };
    const now = new Date();
    const windows = await tx.correctionsNetworkWindow.findMany({ where: { organisationId: access.organisationId, distributionId: current.id }, select: { id: true } });
    await tx.correctionsProgrammeDistribution.update({ where: { id: current.id }, data: { status: "WITHDRAWN", withdrawnAt: now } });
    await tx.correctionsNetworkWindow.updateMany({ where: { organisationId: access.organisationId, distributionId: current.id, active: true }, data: { active: false } });
    let cancelledIntents = 0;
    for (const window of windows) {
      const cancelled = await tx.playoutIntent.updateMany({ where: {
        organisationId: access.organisationId, locationId: current.targetFacilityId,
        sourceRevision: { startsWith: `c7:${window.id}:${current.id}:` }, cancelledAt: null, expiresAt: { gt: now }
      }, data: { cancelledAt: now } });
      cancelledIntents += cancelled.count;
    }
    await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "WARNING",
      title: "Inside network audio withdrawn", message: "A facility distribution was withdrawn. Its queued play is cancelled; review the current approved central/default programme for the affected facility.",
      entityType: "CorrectionsProgrammeDistribution", entityId: current.id,
      dedupeKey: `corrections-network-withdrawn:${current.id}`, correlationId: current.id });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_DISTRIBUTION_WITHDRAWN", entityType: "CorrectionsProgrammeDistribution", entityId: current.id,
      details: { targetFacilityId: current.targetFacilityId, submissionId: current.submissionId, futureWindowsDisabled: true, cancelledIntents } } });
    return { id: current.id, status: "WITHDRAWN" };
  });
}

export async function createCorrectionsNetworkWindow(access, input) {
  const facilityId = String(input.facilityId || "");
  const values = normalizeCorrectionsNetworkWindow(input);
  return runSerializableTransaction(prisma, async (tx) => {
    const member = await tx.organisationMember.findFirst({ where: { id: access.context.membership.id, organisationId: access.organisationId, userId: access.context.user.id }, select: { id: true, role: true } });
    const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
    const entitlement = resolveEntitlements(subscription);
    if (!member || !entitlement.correctionsRadioEnabled || Number(entitlement.planTierNumber) < 4) throw bad("Inside Network is not active for this authority.", 403);
    if (values.kind === "CENTRAL") await correctionsNetworkAuthority(tx, access, "programme");
    else if (member.role !== "OWNER") {
      const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId } } });
      if (member.role !== "MANAGER" || grant?.organisationId !== access.organisationId || grant.permission !== "MANAGER") throw bad("Only an authorised facility manager may set its local windows.", 403);
    }
    const facility = await tx.correctionsFacility.findFirst({ where: { locationId: facilityId, policyConfiguredAt: { not: null }, location: { organisationId: access.organisationId, status: "ACTIVE" } },
      include: { location: { select: { organisationId: true, status: true, countryCode: true } } } });
    if (!facility) throw bad("Choose an active policy-configured facility in this authority.", 404);
    await tx.$queryRaw`SELECT "locationId" FROM "CorrectionsFacility" WHERE "locationId" = ${facilityId} FOR UPDATE`;
    const distribution = await tx.correctionsProgrammeDistribution.findFirst({ where: { id: values.distributionId, organisationId: access.organisationId,
      targetFacilityId: facilityId, status: "ACTIVE", effectiveFrom: { lte: new Date() }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }] } });
    if (!distribution) throw bad("Choose a current approved distribution for this facility.", 409);
    if (values.kind === "LOCAL" && distribution.sourceFacilityId !== facilityId) throw bad("A local window needs a programme originating at its own facility.", 409);
    const source = await approvedCorrectionsNetworkSource(tx, access.organisationId, distribution.programmeId, distribution.submissionId);
    assertCorrectionsNetworkTarget(access.organisationId, source, facility);
    const existing = await tx.correctionsNetworkWindow.findMany({ where: { organisationId: access.organisationId, facilityId, weekday: values.weekday, active: true } });
    const candidate = { ...values, facilityId, active: true };
    const conflict = existing.map((window) => correctionsWindowConflict(window, candidate)).find(Boolean);
    if (conflict) throw bad("This window conflicts with an existing central or local block.", 409);
    if (values.kind === "LOCAL" && !existing.some((window) => window.kind === "CENTRAL" && !window.mandatory && window.startMinute <= values.startMinute && window.endMinute >= values.endMinute)) {
      throw bad("A local window needs a current approved central default covering the full period before it can be prepared.", 409);
    }
    const window = await tx.correctionsNetworkWindow.create({ data: { organisationId: access.organisationId, facilityId, ...values,
      createdByUserId: access.context.user.id } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_WINDOW_CREATED", entityType: "CorrectionsNetworkWindow", entityId: window.id,
      details: { facilityId, kind: values.kind, weekday: values.weekday, startMinute: values.startMinute,
        endMinute: values.endMinute, mandatory: values.mandatory, distributionId: values.distributionId } } });
    return { id: window.id, facilityId, kind: window.kind };
  });
}

export async function listCorrectionsNetworkWindows(access, facilityId = null) {
  if (!access?.ok) throw bad("Sign in to Ruvanas Inside.", 403);
  const member = await prisma.organisationMember.findFirst({ where: { id: access.context.membership.id, organisationId: access.organisationId, userId: access.context.user.id }, select: { id: true, role: true } });
  const subscription = await prisma.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
  const entitlement = resolveEntitlements(subscription);
  if (!member || !entitlement.correctionsRadioEnabled || Number(entitlement.planTierNumber) < 4) throw bad("Inside Network requires Tier 4 or above.", 403);
  if (!facilityId) await correctionsNetworkAuthority(prisma, access, "view");
  else {
    const facility = await prisma.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId: access.organisationId, status: "ACTIVE" } } });
    if (!facility) throw bad("Facility not available.", 404);
    if (member.role !== "OWNER") {
      const grant = await prisma.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId } } });
      if (grant?.organisationId !== access.organisationId || !["MANAGER", "EDITOR", "VIEWER"].includes(grant.permission)) await correctionsNetworkAuthority(prisma, access, "view");
    }
  }
  return prisma.correctionsNetworkWindow.findMany({ where: { organisationId: access.organisationId, ...(facilityId ? { facilityId } : {}) },
    orderBy: [{ facilityId: "asc" }, { weekday: "asc" }, { startMinute: "asc" }], take: 500,
    select: { id: true, facilityId: true, kind: true, mandatory: true, distributionId: true, weekday: true, startMinute: true,
      endMinute: true, allowedContentTypes: true, active: true } });
}

export async function deactivateCorrectionsNetworkWindow(access, windowId) {
  return runSerializableTransaction(prisma, async (tx) => {
    if (!access?.ok) throw bad("Sign in to Ruvanas Inside.", 403);
    const window = await tx.correctionsNetworkWindow.findFirst({ where: { id: windowId, organisationId: access.organisationId } });
    if (!window) throw bad("Network window not found.", 404);
    const member = await tx.organisationMember.findFirst({ where: { id: access.context.membership.id, organisationId: access.organisationId, userId: access.context.user.id }, select: { id: true, role: true } });
    const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
    const entitlement = resolveEntitlements(subscription);
    if (!member || !entitlement.correctionsRadioEnabled || Number(entitlement.planTierNumber) < 4) throw bad("Inside Network requires Tier 4 or above.", 403);
    if (window.kind === "CENTRAL") await correctionsNetworkAuthority(tx, access, "programme");
    else if (member.role !== "OWNER") {
      const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId: window.facilityId } } });
      if (member.role !== "MANAGER" || grant?.organisationId !== access.organisationId || grant.permission !== "MANAGER") throw bad("Only an authorised facility manager may change its local windows.", 403);
    }
    if (!window.active) return { id: window.id, active: false };
    await tx.correctionsNetworkWindow.update({ where: { id: window.id }, data: { active: false } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_WINDOW_DEACTIVATED", entityType: "CorrectionsNetworkWindow", entityId: window.id,
      details: { facilityId: window.facilityId, kind: window.kind, distributionId: window.distributionId } } });
    return { id: window.id, active: false };
  });
}
