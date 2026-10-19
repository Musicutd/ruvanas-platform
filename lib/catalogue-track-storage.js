import crypto from "crypto";
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { validateAudioUpload } from "@/lib/audio-validation.mjs";
import { catalogueStorageKey, MAX_CATALOGUE_FILE_SIZE_BYTES } from "@/lib/catalogue-upload.mjs";
import { resolveNewCatalogueGenres } from "@/lib/catalogue-new-genres.mjs";
import { measureCatalogueAudioDuration } from "@/lib/catalogue-audio-duration.mjs";

// A batch checks and then stores the same Buffer. Reuse only our own probe
// promise, never a duration supplied by the browser or an inspection object.
const measuredDurations = new WeakMap();

export class CatalogueTrackStorageError extends Error {
  constructor(message, status = 400, code = "CATALOGUE_UPLOAD_INVALID") {
    super(message);
    this.name = "CatalogueTrackStorageError";
    this.status = status;
    this.code = code;
  }
}

function storageAbortError() {
  return new CatalogueTrackStorageError("The private sample storage deadline expired.", 504, "CATALOGUE_STORAGE_TIMEOUT");
}

async function sendStorageCommand(client, command, abortSignal = null) {
  if (!abortSignal) return client.send(command);
  if (abortSignal.aborted) throw storageAbortError();
  let onAbort;
  const deadline = new Promise((_, reject) => {
    onAbort = () => reject(storageAbortError());
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // The SDK receives cancellation, while the race also bounds an SDK that
    // does not settle after cancellation. A late object write remains ambiguous.
    return await Promise.race([client.send(command, { abortSignal }), deadline]);
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
  }
}

async function deleteStorageObject(key, abortSignal = null) {
  if (!key) return;
  const r2 = getR2Storage();
  await sendStorageCommand(r2.client,
    new DeleteObjectCommand({ Bucket: r2.bucketName, Key: key }), abortSignal);
}

export async function inspectCatalogueAudio({ buffer, fileName, claimedType = "" }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new CatalogueTrackStorageError("Choose a music file before uploading.");
  }
  if (buffer.length > MAX_CATALOGUE_FILE_SIZE_BYTES) {
    throw new CatalogueTrackStorageError("The music file exceeds the 50 MB upload limit.", 413, "CATALOGUE_FILE_TOO_LARGE");
  }
  const validation = validateAudioUpload({ buffer, fileName, claimedType });
  if (!validation.ok) {
    throw new CatalogueTrackStorageError(validation.error, 400, "CATALOGUE_AUDIO_INVALID");
  }
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  let cached = measuredDurations.get(buffer);
  if (!cached || cached.checksum !== checksum) {
    cached = { checksum, duration: measureCatalogueAudioDuration(buffer) };
    measuredDurations.set(buffer, cached);
  }
  let durationSeconds;
  try {
    durationSeconds = await cached.duration;
  } catch {
    measuredDurations.delete(buffer);
    throw new CatalogueTrackStorageError("The audio length could not be verified. No track was saved. Check the music file and try again.", 400, "CATALOGUE_DURATION_UNVERIFIED");
  }
  return {
    checksum,
    durationSeconds,
    contentType: validation.contentType,
    extension: validation.extension,
    storageKey: catalogueStorageKey(checksum, validation.extension)
  };
}

export async function findExistingCatalogueChecksums(inspectedFiles) {
  const keys = [...new Set(inspectedFiles.map((item) => item.storageKey))];
  if (!keys.length) return new Set();
  const assets = await prisma.mediaAsset.findMany({
    where: { storageKey: { in: keys }, track: { isNot: null } },
    select: { storageKey: true }
  });
  return new Set(assets.map((asset) => asset.storageKey));
}

export async function storeCatalogueTrack({ buffer, fileName, claimedType = "", metadata, actorUserId, inspected = null, auditContext = null, reviewApproved = true, newGenreNames = [], privateSampleStorage = null }) {
  if (privateSampleStorage && (!(privateSampleStorage.abortSignal instanceof AbortSignal) ||
      typeof privateSampleStorage.recordKeys !== "function" ||
      !Number.isInteger(privateSampleStorage.cleanupTimeoutMs) ||
      privateSampleStorage.cleanupTimeoutMs < 1 || privateSampleStorage.cleanupTimeoutMs > 10_000)) {
    throw new CatalogueTrackStorageError("Invalid private sample storage boundary.", 400, "CATALOGUE_STORAGE_BOUNDARY_INVALID");
  }
  let mediaAssetId = null;
  let quarantineKey = null;
  let finalStorageKey = null;
  let wroteFinalObject = false;
  let copyAttempted = false;
  let transactionAttempted = false;
  let shouldRejectMediaAsset = false;
  let needsStorageWrite = false;
  let preexistingReadyAsset = false;

  try {
    // Verify before the first database or storage write, even for provider and
    // pre-inspected imports. Spreadsheet clocks are never authoritative.
    const audio = await inspectCatalogueAudio({ buffer, fileName, claimedType });
    if (inspected && inspected.storageKey !== audio.storageKey) {
      throw new CatalogueTrackStorageError("The checked audio changed. Check the files again.", 400, "CATALOGUE_AUDIO_CHANGED");
    }
    finalStorageKey = audio.storageKey;
    quarantineKey = `quarantine/catalogue/${crypto.randomUUID()}.${audio.extension}`;

    const existingAsset = await prisma.mediaAsset.findUnique({
      where: { storageKey: finalStorageKey },
      include: { track: { select: { id: true } } }
    });

    if (existingAsset?.track) {
      throw new CatalogueTrackStorageError("This music file already exists in the Ruvanas catalogue.", 409, "CATALOGUE_DUPLICATE");
    }
    if (existingAsset && (existingAsset.organisationId !== null || existingAsset.libraryType !== "RUVANAS_CATALOGUE" || existingAsset.mediaType !== "MUSIC")) {
      throw new CatalogueTrackStorageError("This file conflicts with another protected media record.", 409, "CATALOGUE_MEDIA_CONFLICT");
    }

    const sizeBytes = BigInt(buffer.length);
    preexistingReadyAsset = existingAsset?.status === "READY";
    needsStorageWrite = !preexistingReadyAsset;
    if (privateSampleStorage) {
      if (privateSampleStorage.abortSignal.aborted) throw storageAbortError();
      // This receipt is durable before any private-sample media write. It lets
      // an operator inspect both keys after a lost CopyObject response.
      await privateSampleStorage.recordKeys({
        checksum: audio.checksum, quarantineKey, finalStorageKey,
        needsStorageWrite, preexistingReadyAsset
      });
      if (privateSampleStorage.abortSignal.aborted) throw storageAbortError();
    }
    shouldRejectMediaAsset = needsStorageWrite;
    const mediaAsset = existingAsset
      ? await prisma.mediaAsset.update({
          where: { id: existingAsset.id },
          data: {
            name: metadata.title,
            originalName: fileName,
            mimeType: audio.contentType,
            sizeBytes,
            durationSeconds: audio.durationSeconds,
            licensedCatalogue: metadata.licensedCatalogue,
            status: needsStorageWrite ? "PROCESSING" : "READY"
          }
        })
      : await prisma.mediaAsset.create({
          data: {
            organisationId: null,
            libraryType: "RUVANAS_CATALOGUE",
            name: metadata.title,
            originalName: fileName,
            storageKey: finalStorageKey,
            mimeType: audio.contentType,
            sizeBytes,
            durationSeconds: audio.durationSeconds,
            mediaType: "MUSIC",
            status: "PROCESSING",
            licensedCatalogue: metadata.licensedCatalogue
          }
        });
    mediaAssetId = mediaAsset.id;

    if (needsStorageWrite) {
      const r2 = getR2Storage();
      await sendStorageCommand(r2.client, new PutObjectCommand({
        Bucket: r2.bucketName,
        Key: quarantineKey,
        Body: buffer,
        ContentType: audio.contentType,
        Metadata: { checksum: audio.checksum, quarantine: "true", mediaType: "music" }
      }), privateSampleStorage?.abortSignal);
      if (privateSampleStorage?.abortSignal.aborted) throw storageAbortError();
      copyAttempted = true;
      await sendStorageCommand(r2.client, new CopyObjectCommand({
        Bucket: r2.bucketName,
        CopySource: `${r2.bucketName}/${quarantineKey}`,
        Key: finalStorageKey,
        ContentType: audio.contentType,
        MetadataDirective: "REPLACE",
        Metadata: { checksum: audio.checksum, quarantine: "false", mediaType: "music" }
      }), privateSampleStorage?.abortSignal);
      wroteFinalObject = true;
      await deleteStorageObject(quarantineKey, privateSampleStorage?.abortSignal);
      quarantineKey = null;
    }

    if (privateSampleStorage?.abortSignal.aborted) throw storageAbortError();
    transactionAttempted = true;
    return await prisma.$transaction(async (tx) => {
      if (privateSampleStorage?.abortSignal.aborted) throw storageAbortError();
      await tx.mediaAsset.update({ where: { id: mediaAsset.id }, data: { status: "READY" } });
      const newGenres = await resolveNewCatalogueGenres(tx, newGenreNames);
      const genreIds = [...new Set([...metadata.genreIds, ...newGenres.ids])];
      if (genreIds.length) {
        await tx.mediaAssetGenre.createMany({
          data: genreIds.map((mediaGenreId, index) => ({ mediaAssetId: mediaAsset.id, mediaGenreId, isPrimary: index === 0 })),
          skipDuplicates: true
        });
      }
      const created = await tx.track.create({
        data: {
          mediaAssetId: mediaAsset.id,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          mixName: metadata.mixName,
          bpm: metadata.bpm,
          releaseYear: metadata.releaseYear,
          releaseDate: metadata.releaseDate || null,
          recordLabel: metadata.recordLabel || null,
          contentWarning: metadata.contentWarning || null,
          catalogueProvider: metadata.catalogueProvider || null,
          minimumCatalogueLevel: metadata.minimumCatalogueLevel,
          isExplicit: metadata.isExplicit,
          status: metadata.status,
          rightsHolder: metadata.rightsHolder,
          rightsReference: metadata.rightsReference,
          rightsBasis: "OTHER",
          permittedTerritories: metadata.permittedTerritories,
          permittedUses: metadata.permittedUses,
          licenceExpiresAt: metadata.licenceExpiresAt,
          rightsConfirmedAt: reviewApproved ? new Date() : null,
          rightsConfirmedById: reviewApproved ? actorUserId : null,
          rightsReviewStatus: reviewApproved ? "APPROVED" : "DRAFT",
          rightsReviewedAt: reviewApproved ? new Date() : null,
          rightsReviewedById: reviewApproved ? actorUserId : null
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: "CATALOGUE_TRACK_UPLOADED",
          entityType: "Track",
          entityId: created.id,
          details: {
            ...(auditContext || {}),
            mediaAssetId: mediaAsset.id,
            title: created.title,
            artist: created.artist,
            mixName: created.mixName,
            bpm: created.bpm,
            status: created.status,
            rightsHolder: created.rightsHolder,
            rightsReference: created.rightsReference,
            permittedTerritories: created.permittedTerritories,
            licenceExpiresAt: created.licenceExpiresAt?.toISOString() || null,
            checksum: audio.checksum,
            sizeBytes: sizeBytes.toString(),
            durationSeconds: audio.durationSeconds,
            submittedDurationSeconds: metadata.durationSeconds ?? null,
            durationSource: "VERIFIED_AUDIO",
            genreIds,
            spreadsheetCreatedGenres: newGenres.createdNames,
            licensedCatalogue: metadata.licensedCatalogue,
            minimumCatalogueLevel: metadata.minimumCatalogueLevel,
            permittedUses: metadata.permittedUses
          }
        }
      });
      return { track: created, mediaAsset, audio };
    });
  } catch (error) {
    if (privateSampleStorage) {
      // An attempted copy may have committed even when the response was lost.
      // Never delete a key that belonged to a pre-existing READY asset.
      const cleanupSignal = AbortSignal.timeout(privateSampleStorage.cleanupTimeoutMs);
      if (copyAttempted && !transactionAttempted && needsStorageWrite &&
          !preexistingReadyAsset && finalStorageKey) {
        try { await deleteStorageObject(finalStorageKey, cleanupSignal); } catch {}
      }
      if (quarantineKey && !cleanupSignal.aborted) {
        try { await deleteStorageObject(quarantineKey, cleanupSignal); } catch {}
      }
    } else {
      if (quarantineKey) {
        try { await deleteStorageObject(quarantineKey); } catch {}
      }
      if (wroteFinalObject && finalStorageKey) {
        try { await deleteStorageObject(finalStorageKey); } catch {}
      }
    }
    if (mediaAssetId && shouldRejectMediaAsset &&
        (!privateSampleStorage || !transactionAttempted)) {
      try { await prisma.mediaAsset.update({ where: { id: mediaAssetId }, data: { status: "REJECTED" } }); } catch {}
    }
    throw error;
  }
}
