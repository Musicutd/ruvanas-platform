import crypto from "crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { validateAudioUpload } from "@/lib/audio-validation.mjs";
import {
  catalogueStorageKey,
  MAX_CATALOGUE_FILE_SIZE_BYTES,
  parseCatalogueMetadata
} from "@/lib/catalogue-upload.mjs";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function superAdminOnly(access) {
  if (!access.ok) {
    return accessDenied(access);
  }

  if (access.user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a Ruvanas Super Admin can upload catalogue music." },
      { status: 403 }
    );
  }

  return null;
}

async function deleteStorageObject(key) {
  if (!key) return;

  const r2 = getR2Storage();
  await r2.client.send(
    new DeleteObjectCommand({ Bucket: r2.bucketName, Key: key })
  );
}

export async function POST(request) {
  let mediaAssetId = null;
  let quarantineKey = null;
  let finalStorageKey = null;
  let wroteFinalObject = false;
  let shouldRejectMediaAsset = false;

  try {
    const access = await requirePlatformAdmin();
    const denied = superAdminOnly(access);

    if (denied) {
      return denied;
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Choose a music file before uploading." },
        { status: 400 }
      );
    }

    if (file.size > MAX_CATALOGUE_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "The music file exceeds the 50 MB upload limit." },
        { status: 413 }
      );
    }

    const metadata = parseCatalogueMetadata({
      title: formData.get("title"),
      artist: formData.get("artist"),
      album: formData.get("album"),
      releaseYear: formData.get("releaseYear"),
      durationSeconds: formData.get("durationSeconds"),
      isExplicit: formData.get("isExplicit"),
      rightsHolder: formData.get("rightsHolder"),
      rightsReference: formData.get("rightsReference"),
      permittedTerritories: formData.get("permittedTerritories"),
      licenceExpiresAt: formData.get("licenceExpiresAt"),
      rightsConfirmed: formData.get("rightsConfirmed"),
      publishNow: formData.get("publishNow"),
      genreIds: formData.getAll("genreIds").map(String)
    });

    if (!metadata.ok) {
      return NextResponse.json({ error: metadata.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const audioValidation = validateAudioUpload({
      buffer,
      fileName: file.name,
      claimedType: file.type
    });

    if (!audioValidation.ok) {
      securityLog("warn", "CATALOGUE_UPLOAD_REJECTED", request, {
        reason: "invalid_audio_signature",
        actorUserId: access.user.id
      });
      return NextResponse.json({ error: audioValidation.error }, { status: 400 });
    }

    const genres = metadata.data.genreIds.length
      ? await prisma.mediaGenre.findMany({
          where: { id: { in: metadata.data.genreIds }, active: true },
          select: { id: true }
        })
      : [];

    if (genres.length !== metadata.data.genreIds.length) {
      return NextResponse.json(
        { error: "One or more selected genres are unavailable." },
        { status: 400 }
      );
    }

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    finalStorageKey = catalogueStorageKey(checksum, audioValidation.extension);
    quarantineKey = `quarantine/catalogue/${crypto.randomUUID()}.${audioValidation.extension}`;

    const existingAsset = await prisma.mediaAsset.findUnique({
      where: { storageKey: finalStorageKey },
      include: { track: { select: { id: true } } }
    });

    if (existingAsset?.track) {
      return NextResponse.json(
        { error: "This music file already exists in the Ruvanas catalogue." },
        { status: 409 }
      );
    }

    if (
      existingAsset &&
      (existingAsset.organisationId !== null ||
        existingAsset.libraryType !== "RUVANAS_CATALOGUE" ||
        existingAsset.mediaType !== "MUSIC")
    ) {
      return NextResponse.json(
        { error: "This file conflicts with another protected media record." },
        { status: 409 }
      );
    }

    const sizeBytes = BigInt(file.size);
    const needsStorageWrite = !existingAsset || existingAsset.status !== "READY";
    shouldRejectMediaAsset = needsStorageWrite;
    const mediaAsset = existingAsset
      ? await prisma.mediaAsset.update({
          where: { id: existingAsset.id },
          data: {
            name: metadata.data.title,
            originalName: file.name,
            mimeType: audioValidation.contentType,
            sizeBytes,
            durationSeconds: metadata.data.durationSeconds,
            status: needsStorageWrite ? "PROCESSING" : "READY"
          }
        })
      : await prisma.mediaAsset.create({
          data: {
            organisationId: null,
            libraryType: "RUVANAS_CATALOGUE",
            name: metadata.data.title,
            originalName: file.name,
            storageKey: finalStorageKey,
            mimeType: audioValidation.contentType,
            sizeBytes,
            durationSeconds: metadata.data.durationSeconds,
            mediaType: "MUSIC",
            status: "PROCESSING"
          }
        });

    mediaAssetId = mediaAsset.id;

    if (needsStorageWrite) {
      const r2 = getR2Storage();

      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucketName,
          Key: quarantineKey,
          Body: buffer,
          ContentType: audioValidation.contentType,
          Metadata: { checksum, quarantine: "true", mediaType: "music" }
        })
      );

      await r2.client.send(
        new CopyObjectCommand({
          Bucket: r2.bucketName,
          CopySource: `${r2.bucketName}/${quarantineKey}`,
          Key: finalStorageKey,
          ContentType: audioValidation.contentType,
          MetadataDirective: "REPLACE",
          Metadata: { checksum, quarantine: "false", mediaType: "music" }
        })
      );
      wroteFinalObject = true;

      await deleteStorageObject(quarantineKey);
      quarantineKey = null;
    }

    const track = await prisma.$transaction(async (tx) => {
      await tx.mediaAsset.update({
        where: { id: mediaAsset.id },
        data: { status: "READY" }
      });

      if (metadata.data.genreIds.length) {
        await tx.mediaAssetGenre.createMany({
          data: metadata.data.genreIds.map((mediaGenreId, index) => ({
            mediaAssetId: mediaAsset.id,
            mediaGenreId,
            isPrimary: index === 0
          })),
          skipDuplicates: true
        });
      }

      const created = await tx.track.create({
        data: {
          mediaAssetId: mediaAsset.id,
          title: metadata.data.title,
          artist: metadata.data.artist,
          album: metadata.data.album,
          releaseYear: metadata.data.releaseYear,
          isExplicit: metadata.data.isExplicit,
          status: metadata.data.status,
          rightsHolder: metadata.data.rightsHolder,
          rightsReference: metadata.data.rightsReference,
          permittedTerritories: metadata.data.permittedTerritories,
          licenceExpiresAt: metadata.data.licenceExpiresAt,
          rightsConfirmedAt: new Date(),
          rightsConfirmedById: access.user.id
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: access.user.id,
          action: "CATALOGUE_TRACK_UPLOADED",
          entityType: "Track",
          entityId: created.id,
          details: {
            mediaAssetId: mediaAsset.id,
            title: created.title,
            artist: created.artist,
            status: created.status,
            rightsHolder: created.rightsHolder,
            rightsReference: created.rightsReference,
            permittedTerritories: created.permittedTerritories,
            licenceExpiresAt: created.licenceExpiresAt?.toISOString() || null,
            checksum,
            sizeBytes: sizeBytes.toString(),
            genreIds: metadata.data.genreIds
          }
        }
      });

      return created;
    });

    securityLog("info", "CATALOGUE_UPLOAD_SUCCEEDED", request, {
      actorUserId: access.user.id,
      trackId: track.id,
      mediaAssetId: mediaAsset.id,
      status: track.status
    });

    return NextResponse.json(
      {
        ok: true,
        track: {
          id: track.id,
          title: track.title,
          artist: track.artist,
          status: track.status
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (quarantineKey) {
      try {
        await deleteStorageObject(quarantineKey);
      } catch {
        // The quarantine lifecycle policy is the final cleanup fallback.
      }
    }

    if (wroteFinalObject && finalStorageKey) {
      try {
        await deleteStorageObject(finalStorageKey);
      } catch {
        // A protected orphan is safer than deleting an unknown object.
      }
    }

    if (mediaAssetId && shouldRejectMediaAsset) {
      try {
        await prisma.mediaAsset.update({
          where: { id: mediaAssetId },
          data: { status: "REJECTED" }
        });
      } catch {
        // Preserve the original failure response when the record cannot be updated.
      }
    }

    securityLog("error", "CATALOGUE_UPLOAD_ERROR", request, {
      mediaAssetId,
      error: error instanceof Error ? error.message : "unknown"
    });

    return NextResponse.json(
      { error: "The catalogue track could not be uploaded. Please try again." },
      { status: 500 }
    );
  }
}

