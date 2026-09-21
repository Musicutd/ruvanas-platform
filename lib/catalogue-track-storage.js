import crypto from "crypto";
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { validateAudioUpload } from "@/lib/audio-validation.mjs";
import { catalogueStorageKey, MAX_CATALOGUE_FILE_SIZE_BYTES } from "@/lib/catalogue-upload.mjs";
import { resolveNewCatalogueGenres } from "@/lib/catalogue-new-genres.mjs";

export class CatalogueTrackStorageError extends Error {
  constructor(message, status = 400, code = "CATALOGUE_UPLOAD_INVALID") {
    super(message);
    this.name = "CatalogueTrackStorageError";
    this.status = status;
    this.code = code;
  }
}

async function deleteStorageObject(key) {
  if (!key) return;
  const r2 = getR2Storage();
  await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: key }));
}

export function inspectCatalogueAudio({ buffer, fileName, claimedType = "" }) {
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
  return {
    checksum,
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

export async function storeCatalogueTrack({ buffer, fileName, claimedType = "", metadata, actorUserId, inspected = null, auditContext = null, reviewApproved = true, newGenreNames = [] }) {
  let mediaAssetId = null;
  let quarantineKey = null;
  let finalStorageKey = null;
  let wroteFinalObject = false;
  let shouldRejectMediaAsset = false;

  try {
    const audio = inspected || inspectCatalogueAudio({ buffer, fileName, claimedType });
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
    const needsStorageWrite = !existingAsset || existingAsset.status !== "READY";
    shouldRejectMediaAsset = needsStorageWrite;
    const mediaAsset = existingAsset
      ? await prisma.mediaAsset.update({
          where: { id: existingAsset.id },
          data: {
            name: metadata.title,
            originalName: fileName,
            mimeType: audio.contentType,
            sizeBytes,
            durationSeconds: metadata.durationSeconds,
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
            durationSeconds: metadata.durationSeconds,
            mediaType: "MUSIC",
            status: "PROCESSING",
            licensedCatalogue: metadata.licensedCatalogue
          }
        });
    mediaAssetId = mediaAsset.id;

    if (needsStorageWrite) {
      const r2 = getR2Storage();
      await r2.client.send(new PutObjectCommand({
        Bucket: r2.bucketName,
        Key: quarantineKey,
        Body: buffer,
        ContentType: audio.contentType,
        Metadata: { checksum: audio.checksum, quarantine: "true", mediaType: "music" }
      }));
      await r2.client.send(new CopyObjectCommand({
        Bucket: r2.bucketName,
        CopySource: `${r2.bucketName}/${quarantineKey}`,
        Key: finalStorageKey,
        ContentType: audio.contentType,
        MetadataDirective: "REPLACE",
        Metadata: { checksum: audio.checksum, quarantine: "false", mediaType: "music" }
      }));
      wroteFinalObject = true;
      await deleteStorageObject(quarantineKey);
      quarantineKey = null;
    }

    return await prisma.$transaction(async (tx) => {
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
          minimumCatalogueLevel: metadata.minimumCatalogueLevel || "NONE",
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
            genreIds,
            spreadsheetCreatedGenres: newGenres.createdNames,
            licensedCatalogue: metadata.licensedCatalogue,
            permittedUses: metadata.permittedUses,
            ...(auditContext || {})
          }
        }
      });
      return { track: created, mediaAsset, audio };
    });
  } catch (error) {
    if (quarantineKey) {
      try { await deleteStorageObject(quarantineKey); } catch {}
    }
    if (wroteFinalObject && finalStorageKey) {
      try { await deleteStorageObject(finalStorageKey); } catch {}
    }
    if (mediaAssetId && shouldRejectMediaAsset) {
      try { await prisma.mediaAsset.update({ where: { id: mediaAssetId }, data: { status: "REJECTED" } }); } catch {}
    }
    throw error;
  }
}
