import { createHash } from "node:crypto";
import { resolveRetailSubscriberWorkspace, RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG,
  RETAIL_SUBSCRIBER_STATION_ID as STATION } from "./retail-subscriber-access.mjs";
import { validateAudioUpload } from "./audio-validation.mjs";
import { measureCatalogueAudioDuration } from "./catalogue-audio-duration.mjs";
import { normalizePromoLanguageCode } from "./promo-versioning.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { RETAIL_COMMERCIAL_UPLOAD_LIMITS as LIMITS } from "./retail-commercial-upload-request.mjs";

const TYPES = new Set(["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"]);
const LIVE_STORAGE = ["UPLOADING", "PROCESSING", "READY"];
const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_COMMERCIAL_UPLOAD_${code}` }); };
const hash = value => createHash("sha256").update(value).digest("hex");
const stamp = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const clean = value => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
const safeBytes = value => { const bytes = Number(value); if (!Number.isSafeInteger(bytes) || bytes < 0) fail("STORAGE_REVIEW"); return bytes; };
const scopeWhere = { organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: { in: LIVE_STORAGE } };
const versionScope = { sourceType: "UPLOAD", sourceReference: { startsWith: "retail-upload-" }, promoAsset: { organisationId: ORG, status: "ACTIVE" },
  mediaAsset: { organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: "READY" } };
const versionSelect = { id: true, promoAssetId: true, mediaAssetId: true, version: true, status: true, qcStatus: true,
  durationSeconds: true, submittedAt: true, reviewedAt: true, promoAsset: { select: { name: true, mediaType: true } },
  mediaAsset: { select: { sizeBytes: true } } };

export async function assertRetailCommercialUploadAccess(db, { context, now = new Date() } = {}) {
  if (!await resolveRetailSubscriberWorkspace(db, context, { now })) fail("ACCESS_DENIED");
  const gb = context.membership.organisation?.subscription?.plan?.storageLimitGb;
  if (!Number.isInteger(gb) || gb <= 0) fail("ACCESS_DENIED");
  // An exact-pilot upload capability; the shared preview plan and all its limits stay unchanged.
  return { actorId: context.session.userId, storageLimitBytes: Math.min(gb * 1024 ** 3, LIMITS.maxStorageBytes), now };
}
async function usage(db) {
  const [sum, count] = await Promise.all([
    db.mediaAsset.aggregate({ where: scopeWhere, _sum: { sizeBytes: true } }),
    db.mediaAsset.count({ where: scopeWhere })
  ]);
  return { usedBytes: BigInt(sum._sum.sizeBytes || 0), count };
}
function publicVersion(row) {
  return { id: row.id, promoAssetId: row.promoAssetId, name: clean(row.promoAsset.name), mediaType: row.promoAsset.mediaType,
    version: row.version, status: row.status, qcStatus: row.qcStatus, durationSeconds: row.durationSeconds,
    sizeBytes: safeBytes(row.mediaAsset.sizeBytes), submittedAt: stamp(row.submittedAt), reviewedAt: stamp(row.reviewedAt) };
}
export async function retailCommercialUploads(db, options = {}) {
  const scope = await assertRetailCommercialUploadAccess(db, options), [used, rows] = await Promise.all([
    usage(db), db.promoVersion.findMany({ where: versionScope, select: versionSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.maxUploads })
  ]);
  return { stationId: STATION, organisationId: ORG, uploads: rows.map(publicVersion), limits: LIMITS,
    usedBytes: safeBytes(used.usedBytes), storageLimitBytes: scope.storageLimitBytes,
    canUpload: used.count < LIMITS.maxUploads && used.usedBytes < BigInt(scope.storageLimitBytes),
    adminApprovalRequired: true, playbackConnected: false };
}
function validateInput(input) {
  if (!input || Object.keys(input).some(key => !["name", "mediaType", "languageCode", "requestId", "rightsConfirmed", "fileName", "claimedType", "buffer"].includes(key)) ||
      typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(input.name) ||
      !TYPES.has(input.mediaType) || typeof input.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId) ||
      typeof input.fileName !== "string" || input.fileName.length > 240 || /[\u0000-\u001f\u007f\\/]/.test(input.fileName)) fail("REQUEST_INVALID");
  if (input.rightsConfirmed !== "true") fail("RIGHTS_REQUIRED");
  if (!Buffer.isBuffer(input.buffer) || !input.buffer.length) fail("FILE_INVALID");
  if (input.buffer.length > LIMITS.maxFileBytes) fail("FILE_TOO_LARGE");
  const audio = validateAudioUpload({ buffer: input.buffer, fileName: input.fileName, claimedType: input.claimedType || "" });
  if (!audio.ok || !["mp3", "wav", "ogg", "m4a"].includes(audio.extension)) fail("FILE_INVALID");
  let languageCode; try { languageCode = normalizePromoLanguageCode(input.languageCode || "und"); } catch { fail("REQUEST_INVALID"); }
  const checksum = hash(input.buffer), name = input.name.trim(), requestId = input.requestId.toLowerCase();
  return { name, languageCode, checksum, requestId, ...audio,
    storageKey: `organisations/${ORG}/promos/${input.mediaType.toLowerCase()}/${checksum}.${audio.extension}` };
}
async function duplicateVersion(db, mediaAssetId) {
  return db.promoVersion.findFirst({ where: { ...versionScope, mediaAssetId }, select: versionSelect, orderBy: { createdAt: "asc" } });
}
async function locked(db, operation) {
  return runSerializableTransaction(db, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-commercial-upload:${ORG}`}))`;
    return operation(tx);
  });
}

export async function uploadRetailCommercial(db, { context, input, now = new Date(), storage,
  measureDuration = measureCatalogueAudioDuration } = {}) {
  const options = { context, now }, scope = await assertRetailCommercialUploadAccess(db, options), meta = validateInput(input);
  if (!storage || typeof storage.put !== "function" || typeof storage.remove !== "function") fail("STORAGE_FAILED");
  const requestHash = hash(JSON.stringify([meta.name, input.mediaType, meta.languageCode, meta.checksum, input.buffer.length]));
  const requestKey = `retail-upload-${hash([ORG, scope.actorId, meta.requestId].join(":"))}`;
  // Reject exhausted capacity before starting a media process. The transaction
  // below repeats this check and reserves capacity, closing concurrent races.
  const preflight = await usage(db);
  if (preflight.count >= LIMITS.maxUploads || preflight.usedBytes + BigInt(input.buffer.length) > BigInt(scope.storageLimitBytes)) {
    const existing = await db.mediaAsset.findUnique({ where: { storageKey: meta.storageKey } });
    if (!existing || existing.status !== "READY") {
      if (preflight.count >= LIMITS.maxUploads) fail("UPLOAD_LIMIT");
      fail("STORAGE_LIMIT");
    }
  }
  // Probe actual bytes, never a browser duration. Admission limits concurrency and probe itself is bounded.
  let durationSeconds; try { durationSeconds = await measureDuration(input.buffer); } catch { fail("DURATION_INVALID"); }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > LIMITS.maxDurationSeconds) fail("DURATION_INVALID");
  const reservation = await locked(db, async tx => {
    await assertRetailCommercialUploadAccess(tx, options);
    const prior = await tx.auditLog.findUnique({ where: { id: requestKey } });
    if (prior && (prior.organisationId !== ORG || prior.actorUserId !== scope.actorId || prior.details?.requestHash !== requestHash)) fail("RETRY_CHANGED");
    const existing = await tx.mediaAsset.findUnique({ where: { storageKey: meta.storageKey } });
    if (existing) {
      if (existing.organisationId !== ORG || existing.libraryType !== "ORGANISATION_PROMO" || existing.mediaType !== input.mediaType ||
          existing.mimeType !== meta.contentType || existing.sizeBytes !== BigInt(input.buffer.length)) fail("STORAGE_REVIEW");
      if (existing.status === "READY") {
        const version = await duplicateVersion(tx, existing.id);
        if (!version) fail("STORAGE_REVIEW");
        if (!prior) await tx.auditLog.create({ data: { id: requestKey, organisationId: ORG, actorUserId: scope.actorId,
          action: "TEST_RETAIL_COMMERCIAL_UPLOAD_DUPLICATE", entityType: "MediaAsset", entityId: existing.id,
          details: { requestHash, sizeBytes: String(input.buffer.length), rightsConfirmed: true, stationId: STATION } } });
        return { duplicate: true, versionId: version.id };
      }
      if (existing.status !== "REJECTED") fail("BUSY");
      // Only a failed, unpublished reservation can be retried in place. Never
      // reactivate media referenced by an older approved/rejected promo version.
      if (await tx.promoVersion.findFirst({ where: { mediaAssetId: existing.id }, select: { id: true } })) fail("STORAGE_REVIEW");
    }
    const used = await usage(tx);
    if (used.count >= LIMITS.maxUploads) fail("UPLOAD_LIMIT");
    if (used.usedBytes + BigInt(input.buffer.length) > BigInt(scope.storageLimitBytes)) fail("STORAGE_LIMIT");
    const data = { organisationId: ORG, libraryType: "ORGANISATION_PROMO", name: meta.name, originalName: input.fileName,
      storageKey: meta.storageKey, mimeType: meta.contentType, sizeBytes: BigInt(input.buffer.length), durationSeconds,
      mediaType: input.mediaType, status: "UPLOADING", licensedCatalogue: false };
    const asset = existing ? await tx.mediaAsset.update({ where: { id: existing.id }, data }) : await tx.mediaAsset.create({ data });
    if (!prior) await tx.auditLog.create({ data: { id: requestKey, organisationId: ORG, actorUserId: scope.actorId,
      action: "TEST_RETAIL_COMMERCIAL_UPLOAD_RESERVED", entityType: "MediaAsset", entityId: asset.id,
      details: { requestHash, sizeBytes: String(input.buffer.length), rightsConfirmed: true, stationId: STATION } } });
    return { duplicate: false, assetId: asset.id };
  });
  if (reservation.duplicate) return { ...await retailCommercialUploads(db, options), uploadedId: reservation.versionId, duplicate: true };
  try {
    await storage.put(meta.storageKey, input.buffer, meta.contentType, meta.checksum);
    const versionId = await locked(db, async tx => {
      await assertRetailCommercialUploadAccess(tx, options);
      const asset = await tx.mediaAsset.findUnique({ where: { storageKey: meta.storageKey } });
      if (!asset || asset.id !== reservation.assetId || asset.status !== "UPLOADING") fail("STORAGE_REVIEW");
      await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: "READY" } });
      const promo = await tx.promoAsset.create({ data: { organisationId: ORG, name: meta.name, mediaType: input.mediaType, languageCode: meta.languageCode } });
      const version = await tx.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: asset.id, version: 1,
        status: "IN_REVIEW", qcStatus: "PENDING", sourceType: "UPLOAD", sourceReference: requestKey,
        languageCode: meta.languageCode, checksumSha256: meta.checksum, durationSeconds,
        submittedById: scope.actorId, submittedAt: now } });
      await tx.auditLog.create({ data: { id: `${requestKey}-complete`, organisationId: ORG, actorUserId: scope.actorId,
        action: "TEST_RETAIL_COMMERCIAL_AUDIO_SUBMITTED", entityType: "PromoVersion", entityId: version.id,
        details: { promoAssetId: promo.id, durationSeconds, mediaType: input.mediaType, sizeBytes: String(input.buffer.length),
          rightsConfirmed: true, status: "IN_REVIEW", stationId: STATION, playbackConnected: false } } });
      return version.id;
    });
    return { ...await retailCommercialUploads(db, options), uploadedId: versionId, duplicate: false };
  } catch (error) {
    // A transaction result can be lost after commit. Never delete a ready or uninspectable object.
    let stored;
    try { stored = await db.mediaAsset.findUnique({ where: { storageKey: meta.storageKey } }); } catch { fail("STORAGE_REVIEW"); }
    if (stored?.id === reservation.assetId && stored.status === "READY") {
      const version = await duplicateVersion(db, stored.id);
      if (version) return { ...await retailCommercialUploads(db, options), uploadedId: version.id, duplicate: true };
      fail("STORAGE_REVIEW");
    }
    if (stored?.id !== reservation.assetId || stored.status !== "UPLOADING") fail("STORAGE_REVIEW");
    try {
      await storage.remove(meta.storageKey);
      await locked(db, async tx => {
        const current = await tx.mediaAsset.findUnique({ where: { storageKey: meta.storageKey } });
        if (current?.id !== reservation.assetId || current.status !== "UPLOADING") fail("STORAGE_REVIEW");
        await tx.mediaAsset.update({ where: { id: current.id }, data: { status: "REJECTED" } });
      });
    } catch { fail("STORAGE_REVIEW"); } // Keep reserved capacity when cleanup is uncertain.
    if (String(error?.code || "").startsWith("RETAIL_COMMERCIAL_UPLOAD_")) throw error;
    fail("STORAGE_FAILED");
  }
}
