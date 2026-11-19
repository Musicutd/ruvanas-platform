import { createHash } from "node:crypto";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "./retail-subscriber-access.mjs";
import { assertRetailCommercialUploadAccess, retailCommercialUploads } from "./retail-commercial-upload-service.mjs";
import { RETAIL_COMMERCIAL_UPLOAD_LIMITS as LIMITS } from "./retail-commercial-upload-request.mjs";
import { retailCommercialMediaIdentity } from "./retail-commercial-media.mjs";
import { normaliseRetailRecordingReview } from "./retail-commercial-subscriber-review-request.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { reviewPromoVersion } from "./promo-versioning.mjs";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_RECORDING_REVIEW_${code}` }); };
const date = value => value instanceof Date && Number.isFinite(value.getTime());
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const kinds = ["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"];
const whereVersion = id => ({ id, sourceType: "UPLOAD", sourceReference: { startsWith: "retail-upload-" },
  promoAsset: { organisationId: ORG, status: "ACTIVE" }, mediaAsset: { organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: "READY", licensedCatalogue: false } });

async function scopedRecording(db, versionId, now) {
  if (!validId(versionId)) fail("INVALID");
  const row = await db.promoVersion.findFirst({ where: whereVersion(versionId), include: { promoAsset: true, mediaAsset: true, processingJobs: { select: { status: true } } } });
  const promo = row?.promoAsset, media = row?.mediaAsset;
  if (!row || row.id !== versionId || row.sourceType !== "UPLOAD" || !/^retail-upload-[a-f0-9]{64}$/.test(row.sourceReference || "") ||
      row.promoAssetId !== promo?.id || row.mediaAssetId !== media?.id || promo.organisationId !== ORG || promo.status !== "ACTIVE" ||
      media.organisationId !== ORG || media.libraryType !== "ORGANISATION_PROMO" || media.status !== "READY" || media.licensedCatalogue !== false ||
      !kinds.includes(promo.mediaType) || promo.mediaType !== media.mediaType) fail("NOT_FOUND");
  let identity;
  try { identity = retailCommercialMediaIdentity({ ...media, checksumSha256: row.checksumSha256 }); } catch { fail("VALIDATION_REQUIRED"); }
  if (!media.storageKey.startsWith(`organisations/${ORG}/promos/${promo.mediaType.toLowerCase()}/`) || identity.sizeBytes > LIMITS.maxFileBytes ||
      !Number.isInteger(row.durationSeconds) || row.durationSeconds < 1 || row.durationSeconds > LIMITS.maxDurationSeconds ||
      row.durationSeconds !== media.durationSeconds || row.version !== 1 || !validId(row.submittedById) ||
      !date(row.submittedAt) || row.submittedAt > now || !Array.isArray(row.processingJobs) ||
      row.processingJobs.some(job => job.status !== "SUCCEEDED")) fail("VALIDATION_REQUIRED");
  // Successful uploads already measured real bytes with the packaged probe.
  // Require both immutable receipts, including the original content binding;
  // this also supports recordings uploaded before subscriber review existed.
  const [reserved, complete] = await Promise.all([
    db.auditLog.findUnique({ where: { id: row.sourceReference } }),
    db.auditLog.findUnique({ where: { id: `${row.sourceReference}-complete` } })
  ]);
  const common = receipt => receipt?.organisationId === ORG && receipt.actorUserId === row.submittedById &&
    date(receipt.createdAt) && receipt.createdAt <= now && receipt.details?.stationId === STATION &&
    receipt.details.rightsConfirmed === true && receipt.details.sizeBytes === String(identity.sizeBytes);
  if (!common(reserved) || reserved.action !== "TEST_RETAIL_COMMERCIAL_UPLOAD_RESERVED" || reserved.entityType !== "MediaAsset" || reserved.entityId !== media.id ||
      reserved.details.requestHash !== hash([promo.name, promo.mediaType, row.languageCode, identity.checksum, identity.sizeBytes]) ||
      !common(complete) || complete.action !== "TEST_RETAIL_COMMERCIAL_AUDIO_SUBMITTED" || complete.entityType !== "PromoVersion" || complete.entityId !== row.id ||
      complete.details.promoAssetId !== promo.id || complete.details.durationSeconds !== row.durationSeconds || complete.details.mediaType !== promo.mediaType ||
      complete.details.status !== "IN_REVIEW" || complete.details.playbackConnected !== false) fail("VALIDATION_REQUIRED");
  return { row, promo, media, identity };
}

// Internal server helper only: the caller must stream privately and must never
// serialise the storage key or return a reusable external listening URL.
export async function readRetailSubscriberRecordingForPreview(db, { context, versionId, now = new Date() } = {}) {
  await assertRetailCommercialUploadAccess(db, { context, now });
  const { row, promo, media, identity } = await scopedRecording(db, versionId, now);
  if (!(row.status === "IN_REVIEW" && row.qcStatus === "PENDING" || row.status === "APPROVED" && row.qcStatus === "PASSED" && promo.currentApprovedVersionId === row.id)) fail("CHANGED");
  return { versionId: row.id, mediaAssetId: media.id, name: promo.name, mimeType: media.mimeType,
    storageKey: media.storageKey, sizeBytes: identity.sizeBytes, checksum: identity.checksum, durationSeconds: row.durationSeconds };
}

export async function reviewRetailSubscriberRecording(db, { context, input, now = new Date() } = {}) {
  const command = normaliseRetailRecordingReview(input), options = { context, now };
  const scope = await assertRetailCommercialUploadAccess(db, options);
  const auditId = `retail-recording-review-${hash([ORG, command.versionId])}`, requestHash = hash(command);
  const result = await runSerializableTransaction(db, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-commercial-upload:${ORG}`}))`;
    await assertRetailCommercialUploadAccess(tx, options);
    const { row, promo } = await scopedRecording(tx, command.versionId, now);
    const prior = await tx.auditLog.findUnique({ where: { id: auditId } });
    const status = command.decision === "APPROVE" ? "APPROVED" : "REJECTED", qcStatus = command.decision === "APPROVE" ? "PASSED" : "FAILED";
    if (prior) {
      if (prior.organisationId !== ORG || prior.actorUserId !== scope.actorId || prior.entityType !== "PromoVersion" || prior.entityId !== row.id ||
          prior.action !== `TEST_RETAIL_SUBSCRIBER_RECORDING_${status}` || prior.details?.requestHash !== requestHash ||
          prior.details.subscriberResponsible !== true || prior.details.rightsConfirmed !== command.rightsConfirmed ||
          row.status !== status || row.qcStatus !== qcStatus || row.reviewedById !== scope.actorId ||
          command.decision === "APPROVE" && promo.currentApprovedVersionId !== row.id) fail("CHANGED");
      return { duplicate: true };
    }
    if (row.status !== "IN_REVIEW" || row.qcStatus !== "PENDING" || row.reviewedAt || row.reviewedById || promo.currentApprovedVersionId !== null || !date(row.updatedAt)) fail("CHANGED");
    const changed = await tx.promoVersion.updateMany({ where: { ...whereVersion(row.id), status: "IN_REVIEW", qcStatus: "PENDING", updatedAt: row.updatedAt,
      reviewedAt: null, reviewedById: null }, data: { status, qcStatus, qcNotes: command.notes || null, reviewedAt: now, reviewedById: scope.actorId } });
    if (changed.count !== 1) fail("CHANGED");
    if (command.decision === "APPROVE") {
      const selected = await tx.promoAsset.updateMany({ where: { id: promo.id, organisationId: ORG, status: "ACTIVE", currentApprovedVersionId: null },
        data: { currentApprovedVersionId: row.id } });
      if (selected.count !== 1) fail("CHANGED");
    }
    await tx.auditLog.create({ data: { id: auditId, organisationId: ORG, actorUserId: scope.actorId,
      action: `TEST_RETAIL_SUBSCRIBER_RECORDING_${status}`, entityType: "PromoVersion", entityId: row.id,
      details: { stationId: STATION, promoAssetId: promo.id, requestHash, decision: command.decision, subscriberResponsible: true,
        rightsConfirmed: command.rightsConfirmed, responsibility: "Own recording content and permission for Retail use", notes: command.notes,
        uploadReceiptId: `${row.sourceReference}-complete`, durationSeconds: row.durationSeconds, version: row.version,
        status, qcStatus, playbackChanged: false } } });
    return { duplicate: false };
  });
  return { ...await retailCommercialUploads(db, options), reviewedId: command.versionId, decision: command.decision, duplicate: result.duplicate };
}

export function isRetailSubscriberUploadedRecording(row) {
  return row?.promoAsset?.organisationId === ORG && row.sourceType === "UPLOAD" && /^retail-upload-[a-f0-9]{64}$/.test(row.sourceReference || "");
}

// Called only after the existing administrator route has authenticated an
// administrator. Exact Retail uploads share the subscriber lock and fresh-state
// comparison, so an old administrator screen cannot reverse a later decision.
export async function reviewRetailUploadedRecordingAsAdmin(db, { promoAssetId, promoVersionId, actorId, decision, notes, now = new Date() }) {
  if (![promoAssetId, promoVersionId, actorId].every(validId) || !date(now)) fail("INVALID");
  return runSerializableTransaction(db, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-commercial-upload:${ORG}`}))`;
    const row = await tx.promoVersion.findFirst({ where: { id: promoVersionId, promoAssetId, sourceType: "UPLOAD",
      sourceReference: { startsWith: "retail-upload-" }, promoAsset: { organisationId: ORG, status: "ACTIVE" } },
      include: { promoAsset: true, processingJobs: { select: { status: true } } } });
    if (!isRetailSubscriberUploadedRecording(row) || row.id !== promoVersionId || row.promoAssetId !== promoAssetId ||
        row.promoAsset?.id !== promoAssetId || row.promoAsset.status !== "ACTIVE" || row.status !== "IN_REVIEW" ||
        row.qcStatus !== "PENDING" || row.reviewedAt || row.reviewedById || row.promoAsset.currentApprovedVersionId !== null || !date(row.updatedAt)) fail("CHANGED");
    if (decision === "APPROVE" && (!Array.isArray(row.processingJobs) || row.processingJobs.some(job => job.status !== "SUCCEEDED"))) fail("VALIDATION_REQUIRED");
    let transition; try { transition = reviewPromoVersion({ currentStatus: row.status, decision, notes }); } catch { fail("INVALID"); }
    const changed = await tx.promoVersion.updateMany({ where: { ...whereVersion(row.id), promoAssetId, status: "IN_REVIEW", qcStatus: "PENDING",
      updatedAt: row.updatedAt, reviewedAt: null, reviewedById: null }, data: { ...transition, reviewedAt: now, reviewedById: actorId } });
    if (changed.count !== 1) fail("CHANGED");
    if (decision === "APPROVE") {
      const selected = await tx.promoAsset.updateMany({ where: { id: promoAssetId, organisationId: ORG, status: "ACTIVE", currentApprovedVersionId: null },
        data: { currentApprovedVersionId: promoVersionId } });
      if (selected.count !== 1) fail("CHANGED");
    }
    await tx.auditLog.create({ data: { organisationId: ORG, actorUserId: actorId,
      action: transition.status === "APPROVED" ? "PROMO_VERSION_APPROVED" : "PROMO_VERSION_REJECTED",
      entityType: "PromoVersion", entityId: promoVersionId, details: { promoAssetId, version: row.version, qcStatus: transition.qcStatus,
        notes: transition.qcNotes, approvalAuthority: "ADMIN", stationId: STATION, playbackChanged: false } } });
    return { ...row, ...transition, reviewedAt: now, reviewedById: actorId };
  });
}
