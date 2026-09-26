import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { correctionsMusicEligibility } from "@/lib/corrections-policy.mjs";
import { correctionsC5Features, correctionsMusicReason, correctionsRequestAllowed, correctionsRequestTransition, normalizeCorrectionsRequest, normalizeOnAirText, safeCorrectionsRequestSummary } from "@/lib/corrections-c5-policy.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }

async function currentMember(tx, access, facilityId, { manager = false } = {}) {
  const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id }, select: { userId: true, organisationId: true, role: true } });
  if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId) throw bad("Your organisation access changed.", 403);
  if (member.role === "OWNER") return member;
  const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: access.context.membership.id, facilityId } } });
  if (!grant || grant.organisationId !== access.organisationId || (manager && (member.role !== "MANAGER" || grant.permission !== "MANAGER")) || (!manager && grant.permission === "VIEWER")) throw bad("You do not have this facility permission.", 403);
  return member;
}

async function currentFeatures(tx, organisationId) {
  const subscription = await tx.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
  const entitlements = resolveEntitlements(subscription);
  return { entitlements, features: correctionsC5Features(entitlements) };
}

async function facilityFor(tx, organisationId, facilityId) {
  const facility = await tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId, status: { not: "CLOSED" } } }, include: { location: { select: { id: true, organisationId: true, countryCode: true } } } });
  if (!facility) throw bad("Facility not available.", 404);
  return facility;
}

export async function setCorrectionsRequestPolicy(access, facilityId, input) {
  const mode = String(input.availability || "");
  if (!["DISABLED", "INTERNAL_ONLY", "FAMILY_AND_INTERNAL"].includes(mode)) throw bad("Choose a request availability setting.");
  return runSerializableTransaction(prisma, async (tx) => {
    await currentMember(tx, access, facilityId, { manager: true });
    const { features } = await currentFeatures(tx, access.organisationId);
    if (!features.internalRequests || (mode === "FAMILY_AND_INTERNAL" && !features.familyRequests)) throw bad("Requests require Ruvanas Inside Tier 2 or above.", 403);
    const facility = await facilityFor(tx, access.organisationId, facilityId);
    const code = mode === "FAMILY_AND_INTERNAL" ? (facility.requestAvailability === "FAMILY_AND_INTERNAL" && facility.publicRequestCode ? facility.publicRequestCode : randomBytes(24).toString("base64url")) : facility.publicRequestCode;
    const saved = await tx.correctionsFacility.update({ where: { locationId: facilityId }, data: {
      requestAvailability: mode, publicRequestCode: code,
      songRequestsEnabled: input.songRequestsEnabled === true,
      messageRequestsEnabled: input.messageRequestsEnabled === true,
      dedicationsEnabled: input.dedicationsEnabled === true
    }, select: { requestAvailability: true, publicRequestCode: true, songRequestsEnabled: true, messageRequestsEnabled: true, dedicationsEnabled: true } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_REQUEST_POLICY_CHANGED", entityType: "CorrectionsFacility", entityId: facilityId, details: { facilityId, availability: mode } } });
    return saved;
  });
}

export async function createInternalCorrectionsRequest(access, input) {
  const normalized = normalizeCorrectionsRequest(input, "INTERNAL");
  return runSerializableTransaction(prisma, async (tx) => {
    const facilityId = String(input.facilityId || "");
    await currentMember(tx, access, facilityId);
    const { features } = await currentFeatures(tx, access.organisationId);
    if (!features.internalRequests) throw bad("Internal requests require Ruvanas Inside Tier 2 or above.", 403);
    const facility = await facilityFor(tx, access.organisationId, facilityId);
    if (!correctionsRequestAllowed(facility, "INTERNAL", normalized.type)) throw bad("This facility does not accept that request type.", 403);
    const created = await tx.correctionsRequest.create({ data: { organisationId: access.organisationId, facilityId, ...normalized, createdByUserId: access.context.user.id }, select: { id: true, createdAt: true } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_INTERNAL_REQUEST_RECEIVED", entityType: "CorrectionsRequest", entityId: created.id, details: { facilityId, type: normalized.type } } });
    return created;
  });
}

export async function createFamilyCorrectionsRequest(input, { requestId, secret } = {}) {
  const normalized = normalizeCorrectionsRequest(input, "FAMILY");
  const code = typeof input.facilityCode === "string" ? input.facilityCode.trim() : "";
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return null;
  return runSerializableTransaction(prisma, async (tx) => {
    const facility = await tx.correctionsFacility.findUnique({ where: { publicRequestCode: code }, include: { location: { select: { organisationId: true, status: true } } } });
    if (!facility || facility.location.status === "CLOSED" || !correctionsRequestAllowed(facility, "FAMILY", normalized.type)) return null;
    const { features } = await currentFeatures(tx, facility.location.organisationId);
    if (!features.familyRequests) return null;
    const bucket = Math.floor(Date.now() / (30 * 60_000));
    const dedupeKey = createHash("sha256").update(JSON.stringify([secret, code, bucket, normalized])).digest("hex");
    if (await tx.correctionsRequest.findUnique({ where: { dedupeKey }, select: { id: true } })) return null;
    const created = await tx.correctionsRequest.create({ data: {
      organisationId: facility.location.organisationId, facilityId: facility.locationId,
      ...normalized, dedupeKey
    }, select: { id: true } });
    await tx.auditLog.create({ data: { organisationId: facility.location.organisationId, action: "CORRECTIONS_FAMILY_REQUEST_RECEIVED", entityType: "CorrectionsRequest", entityId: created.id, details: { facilityId: facility.locationId, type: normalized.type } } });
    await enqueueNotificationEvent(tx, { organisationId: facility.location.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "INFO", title: "Inside request awaiting review", message: "A family radio request is waiting for facility staff.", entityType: "CorrectionsRequest", entityId: created.id, dedupeKey: `corrections-request:${created.id}`, correlationId: requestId || created.id, requestId });
    return created;
  }).catch((error) => { if (error?.code === "P2002") return null; throw error; });
}

export async function listCorrectionsRequests(access, { facilityId, status, type, source, date } = {}) {
  const features = correctionsC5Features(access.entitlements);
  if (!features.internalRequests) throw bad("Requests require Ruvanas Inside Tier 2 or above.", 403);
  const grants = access.context.membership.role === "OWNER" ? null : await prisma.correctionsFacilityGrant.findMany({ where: { organisationId: access.organisationId, organisationMemberId: access.context.membership.id }, select: { facilityId: true } });
  const allowedIds = grants?.map((grant) => grant.facilityId);
  if (facilityId && allowedIds && !allowedIds.includes(facilityId)) throw bad("Facility not available.", 404);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime()) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date)) throw bad("Choose a valid UTC calendar date.");
  const requests = await prisma.correctionsRequest.findMany({ where: { organisationId: access.organisationId,
    ...(facilityId ? { facilityId } : allowedIds ? { facilityId: { in: allowedIds } } : {}),
    ...(["RECEIVED", "SCREENING", "APPROVED", "REJECTED", "SCHEDULED", "PLAYED", "ARCHIVED"].includes(status) ? { status } : {}),
    ...(["INTERNAL", "FAMILY"].includes(source) ? { source } : {}),
    ...(["SONG", "PROGRAMME", "DEDICATION", "MESSAGE", "REHABILITATION_SUGGESTION"].includes(type) ? { type } : {}),
    ...(date ? { createdAt: { gte: new Date(`${date}T00:00:00.000Z`), lt: new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000) } } : {})
  }, orderBy: { createdAt: "desc" }, take: 100 });
  return requests.map(safeCorrectionsRequestSummary);
}

export async function getCorrectionsRequest(access, id) {
  const item = await prisma.correctionsRequest.findFirst({ where: { id, organisationId: access.organisationId }, include: { decisions: { orderBy: { decidedAt: "asc" } } } });
  if (!item) return null;
  await currentMember(prisma, access, item.facilityId, { manager: true });
  return item;
}

async function assertEligibleTrack(tx, request, facility, entitlements, trackId) {
  if (!trackId) throw bad("Attach an eligible recording before approving a song request.");
  const [track, organisationPolicy, configuredGenres] = await Promise.all([
    tx.track.findUnique({ where: { id: trackId }, include: { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }, distributorItems: { include: { canonicalGenre: true } } } }),
    tx.correctionsProfile.findUnique({ where: { organisationId: request.organisationId } }),
    tx.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } })
  ]);
  const eligibility = correctionsMusicEligibility(track, { organisationId: request.organisationId, facility, organisationPolicy, facilityPolicy: facility, licensedCatalogueLevel: entitlements.licensedMusicCatalogueLevel, configuredGenres });
  if (!eligibility.playable) throw bad(`This track cannot be used here because ${correctionsMusicReason(eligibility.reason)}.`, 409);
  return track;
}

export async function reviewCorrectionsRequest(access, id, input) {
  const action = String(input.action || "").toUpperCase();
  const text = normalizeOnAirText(input);
  return runSerializableTransaction(prisma, async (tx) => {
    const item = await tx.correctionsRequest.findFirst({ where: { id, organisationId: access.organisationId } });
    if (!item) throw bad("Request not found.", 404);
    await currentMember(tx, access, item.facilityId, { manager: true });
    const { entitlements, features } = await currentFeatures(tx, access.organisationId);
    if (!features.internalRequests) throw bad("Requests are no longer included in this plan.", 403);
    const facility = await facilityFor(tx, access.organisationId, item.facilityId);
    if (!correctionsRequestAllowed(facility, item.source, item.type) && action !== "REJECT" && action !== "ARCHIVE") throw bad("Requests are disabled by facility policy.", 403);
    const next = correctionsRequestTransition(item, action);
    if (!next) throw bad("This request cannot make that transition.", 409);
    if (action === "REJECT" && (!text.note || text.note.length < 5)) throw bad("Give a short rejection reason.");
    if (action === "APPROVE" && item.recipientReference && text.onAirRecipient?.toLowerCase() === item.recipientReference.toLowerCase()) throw bad("Use a safe display name, not the private recipient reference.");
    if (action === "APPROVE" && ["MESSAGE", "DEDICATION"].includes(item.type) && !text.onAirMessage) throw bad("Choose the approved on-air wording before approval.");
    if (action === "APPROVE" && item.type === "SONG") await assertEligibleTrack(tx, item, facility, entitlements, String(input.trackId || ""));
    const programmeId = input.programmeId ? String(input.programmeId) : item.programmeId;
    if (action === "APPROVE" && item.type === "PROGRAMME" && !programmeId) throw bad("Choose an approved programme before approving this request.");
    if (action === "APPROVE" && programmeId) {
      const programme = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId, facilityId: item.facilityId, status: "APPROVED" } });
      if (!programme) throw bad("Choose an approved programme for this facility.", 409);
    }
    const updated = await tx.correctionsRequest.update({ where: { id }, data: { status: next,
      ...(action === "APPROVE" ? { onAirRecipient: text.onAirRecipient, onAirMessage: text.onAirMessage,
        trackId: item.type === "SONG" ? String(input.trackId) : null, programmeId } : {}) } });
    await tx.correctionsRequestDecision.create({ data: { requestId: id, organisationId: access.organisationId, facilityId: item.facilityId, action,
      fromStatus: item.status, toStatus: next, moderatorUserId: access.context.user.id, note: text.note,
      onAirRecipient: action === "APPROVE" ? text.onAirRecipient : null, onAirMessage: action === "APPROVE" ? text.onAirMessage : null,
      trackId: action === "APPROVE" && item.type === "SONG" ? String(input.trackId) : null, programmeId: action === "APPROVE" ? programmeId : null } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: `CORRECTIONS_REQUEST_${action}`, entityType: "CorrectionsRequest", entityId: id, details: { facilityId: item.facilityId, fromStatus: item.status, toStatus: next } } });
    return safeCorrectionsRequestSummary(updated);
  });
}
