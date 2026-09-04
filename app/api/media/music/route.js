import crypto from "crypto";
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canManageSubscriberAudio } from "@/lib/subscriber-audio-review.mjs";
import { validateAudioUpload } from "@/lib/audio-validation.mjs";
import {
  MAX_ORGANISATION_MUSIC_FILE_SIZE_BYTES,
  organisationMusicStorageKey,
  parseOrganisationMusicMetadata
} from "@/lib/media-library-pro.mjs";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function serializeTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    releaseYear: track.releaseYear,
    isExplicit: track.isExplicit,
    status: track.status,
    rightsHolder: track.rightsHolder,
    rightsReference: track.rightsReference,
    rightsBasis: track.rightsBasis,
    permittedTerritories: track.permittedTerritories,
    permittedUses: track.permittedUses,
    licenceStartsAt: track.licenceStartsAt?.toISOString().slice(0, 10) || null,
    licenceExpiresAt: track.licenceExpiresAt?.toISOString().slice(0, 10) || null,
    rightsReviewStatus: track.rightsReviewStatus,
    rightsReviewNotes: track.rightsReviewNotes,
    rightsConfirmedAt: track.rightsConfirmedAt?.toISOString() || null,
    rightsReviewedAt: track.rightsReviewedAt?.toISOString() || null,
    createdAt: track.createdAt.toISOString(),
    file: {
      id: track.mediaAsset.id,
      originalName: track.mediaAsset.originalName,
      sizeBytes: track.mediaAsset.sizeBytes.toString(),
      durationSeconds: track.mediaAsset.durationSeconds,
      status: track.mediaAsset.status,
      previewUrl: `/api/media/${track.mediaAsset.id}/stream`
    }
  };
}

async function activeContext() {
  return getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } }
  });
}

export async function GET() {
  try {
    const context = await activeContext();
    if (!context) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });

    const entitlements = resolveEntitlements(context.membership.organisation.subscription);
    if (!entitlements.serviceEnabled) {
      return NextResponse.json({ error: "The music library is unavailable while this service is inactive." }, { status: 403 });
    }

    const tracks = await prisma.track.findMany({
      where: {
        mediaAsset: {
          organisationId: context.membership.organisationId,
          libraryType: "ORGANISATION_MUSIC",
          status: { notIn: ["ARCHIVED", "DELETED"] }
        }
      },
      include: { mediaAsset: true },
      orderBy: [{ updatedAt: "desc" }, { artist: "asc" }, { title: "asc" }]
    });

    return NextResponse.json({
      organisation: {
        id: context.membership.organisation.id,
        name: context.membership.organisation.name
      },
      permissions: {
        canUpload: entitlements.promoUploadEnabled && canManageSubscriberAudio(context.membership.role),
        canSubmit: entitlements.promoUploadEnabled && canManageSubscriberAudio(context.membership.role),
        role: context.membership.role
      },
      tracks: tracks.map(serializeTrack)
    });
  } catch (error) {
    console.error("Organisation music library load error:", error);
    return NextResponse.json({ error: "Unable to load the organisation music library." }, { status: 500 });
  }
}

export async function POST(request) {
  let mediaAssetId = null;
  let quarantineKey = null;
  let finalStorageKey = null;
  let wroteFinalObject = false;

  try {
    const context = await activeContext();
    if (!context) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });

    const organisation = context.membership.organisation;
    const entitlements = resolveEntitlements(organisation.subscription);
    if (!entitlements.serviceEnabled || !entitlements.promoUploadEnabled) {
      return NextResponse.json({ error: "Music uploads are not included while this service is inactive." }, { status: 403 });
    }
    if (!canManageSubscriberAudio(context.membership.role)) {
      return NextResponse.json({ error: "An organisation owner, manager or content editor must upload music." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a music file before uploading." }, { status: 400 });
    }
    if (file.size > MAX_ORGANISATION_MUSIC_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "The music file exceeds the 100 MB upload limit." }, { status: 413 });
    }

    const metadata = parseOrganisationMusicMetadata({
      title: formData.get("title"),
      artist: formData.get("artist"),
      album: formData.get("album"),
      releaseYear: formData.get("releaseYear"),
      durationSeconds: formData.get("durationSeconds"),
      isExplicit: formData.get("isExplicit"),
      rightsHolder: formData.get("rightsHolder"),
      rightsReference: formData.get("rightsReference"),
      rightsBasis: formData.get("rightsBasis"),
      permittedTerritories: formData.get("permittedTerritories"),
      permittedUses: formData.getAll("permittedUses").map(String),
      licenceStartsAt: formData.get("licenceStartsAt"),
      licenceExpiresAt: formData.get("licenceExpiresAt"),
      rightsConfirmed: formData.get("rightsConfirmed")
    });
    if (!metadata.ok) return NextResponse.json({ error: metadata.error }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const audio = validateAudioUpload({ buffer, fileName: file.name, claimedType: file.type });
    if (!audio.ok) {
      securityLog("warn", "ORGANISATION_MUSIC_UPLOAD_REJECTED", request, {
        organisationId: organisation.id,
        reason: "invalid_audio_signature"
      });
      return NextResponse.json({ error: audio.error }, { status: 400 });
    }

    const used = await prisma.mediaAsset.aggregate({
      where: {
        organisationId: organisation.id,
        status: { in: ["UPLOADING", "PROCESSING", "READY"] }
      },
      _sum: { sizeBytes: true }
    });
    const limit = BigInt(entitlements.storageLimitGb) * 1024n * 1024n * 1024n;
    if ((used._sum.sizeBytes || 0n) + BigInt(file.size) > limit) {
      return NextResponse.json({ error: "This upload would exceed the organisation storage limit." }, { status: 413 });
    }

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    finalStorageKey = organisationMusicStorageKey(organisation.id, checksum, audio.extension);
    quarantineKey = `quarantine/${organisation.id}/music/${crypto.randomUUID()}.${audio.extension}`;
    const duplicate = await prisma.mediaAsset.findUnique({
      where: { storageKey: finalStorageKey },
      include: { track: { select: { id: true } } }
    });
    if (duplicate?.track) {
      return NextResponse.json({ error: "This recording already exists in your music library." }, { status: 409 });
    }
    if (duplicate && (duplicate.organisationId !== organisation.id || duplicate.libraryType !== "ORGANISATION_MUSIC")) {
      return NextResponse.json({ error: "This file conflicts with another protected media record." }, { status: 409 });
    }

    const mediaAsset = duplicate
      ? await prisma.mediaAsset.update({
          where: { id: duplicate.id },
          data: {
            name: metadata.data.title,
            originalName: file.name,
            mimeType: audio.contentType,
            sizeBytes: BigInt(file.size),
            durationSeconds: metadata.data.durationSeconds,
            status: "PROCESSING"
          }
        })
      : await prisma.mediaAsset.create({
          data: {
            organisationId: organisation.id,
            libraryType: "ORGANISATION_MUSIC",
            name: metadata.data.title,
            originalName: file.name,
            storageKey: finalStorageKey,
            mimeType: audio.contentType,
            sizeBytes: BigInt(file.size),
            durationSeconds: metadata.data.durationSeconds,
            mediaType: "MUSIC",
            status: "PROCESSING"
          }
        });
    mediaAssetId = mediaAsset.id;

    const r2 = getR2Storage();
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucketName,
      Key: quarantineKey,
      Body: buffer,
      ContentType: audio.contentType,
      Metadata: { checksum, quarantine: "true", mediaType: "music", organisationId: organisation.id }
    }));
    await r2.client.send(new CopyObjectCommand({
      Bucket: r2.bucketName,
      CopySource: `${r2.bucketName}/${quarantineKey}`,
      Key: finalStorageKey,
      ContentType: audio.contentType,
      MetadataDirective: "REPLACE",
      Metadata: { checksum, quarantine: "false", mediaType: "music", organisationId: organisation.id }
    }));
    wroteFinalObject = true;
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey }));
    quarantineKey = null;

    const track = await prisma.$transaction(async (tx) => {
      await tx.mediaAsset.update({ where: { id: mediaAsset.id }, data: { status: "READY" } });
      const created = await tx.track.create({
        data: {
          mediaAssetId: mediaAsset.id,
          title: metadata.data.title,
          artist: metadata.data.artist,
          album: metadata.data.album,
          releaseYear: metadata.data.releaseYear,
          isExplicit: metadata.data.isExplicit,
          status: "DRAFT",
          rightsHolder: metadata.data.rightsHolder,
          rightsReference: metadata.data.rightsReference,
          rightsBasis: metadata.data.rightsBasis,
          permittedTerritories: metadata.data.permittedTerritories,
          permittedUses: metadata.data.permittedUses,
          licenceStartsAt: metadata.data.licenceStartsAt,
          licenceExpiresAt: metadata.data.licenceExpiresAt,
          rightsConfirmedAt: new Date(),
          rightsConfirmedById: context.user.id,
          rightsReviewStatus: "DRAFT"
        },
        include: { mediaAsset: true }
      });
      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: context.user.id,
          action: "ORGANISATION_MUSIC_UPLOADED",
          entityType: "Track",
          entityId: created.id,
          details: {
            mediaAssetId: mediaAsset.id,
            checksum,
            title: created.title,
            artist: created.artist,
            rightsBasis: created.rightsBasis,
            permittedUses: created.permittedUses,
            permittedTerritories: created.permittedTerritories,
            rightsReviewStatus: created.rightsReviewStatus
          }
        }
      });
      return created;
    });

    securityLog("info", "ORGANISATION_MUSIC_UPLOAD_SUCCEEDED", request, {
      organisationId: organisation.id,
      actorUserId: context.user.id,
      trackId: track.id,
      mediaAssetId: mediaAsset.id
    });
    return NextResponse.json({ ok: true, track: serializeTrack(track) }, { status: 201 });
  } catch (error) {
    try {
      const r2 = getR2Storage();
      if (quarantineKey) await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey }));
      if (wroteFinalObject && finalStorageKey) await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: finalStorageKey }));
    } catch {
      // Protected lifecycle rules provide the final orphan cleanup fallback.
    }
    if (mediaAssetId) {
      try { await prisma.mediaAsset.update({ where: { id: mediaAssetId }, data: { status: "REJECTED" } }); } catch {}
    }
    securityLog("error", "ORGANISATION_MUSIC_UPLOAD_ERROR", request, {
      mediaAssetId,
      error: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ error: "The music upload could not be completed. Please try again." }, { status: 500 });
  }
}
