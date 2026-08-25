import crypto from "crypto";
import { NextResponse } from "next/server";
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { getCurrentUser } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import {
  ORGANISATION_CONTENT_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { validateAudioUpload } from "@/lib/audio-validation.mjs";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const promoMediaTypes = [
  "COMMERCIAL",
  "JINGLE",
  "ANNOUNCEMENT",
  "VOICEOVER"
];

const uploadSchema = z.object({
  organisationId: z.string().cuid(),
  name: z.string().trim().min(1).max(200),
  mediaType: z.enum([
    "COMMERCIAL",
    "JINGLE",
    "ANNOUNCEMENT",
    "VOICEOVER"
  ]),
  durationSeconds: z.number().int().positive().nullable()
});

export async function POST(request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const organisationId = String(formData.get("organisationId") || "");
    const name = String(formData.get("name") || "");
    const mediaType = String(formData.get("mediaType") || "");
    const durationSecondsValue = String(
      formData.get("durationSeconds") || ""
    ).trim();

    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Choose an audio file before uploading." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "The file exceeds the 50 MB upload limit." },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const audioValidation = validateAudioUpload({
      buffer,
      fileName: file.name,
      claimedType: file.type
    });

    if (!audioValidation.ok) {
      securityLog("warn", "MEDIA_UPLOAD_REJECTED", request, {
        reason: "invalid_audio_signature"
      });
      return NextResponse.json({ error: audioValidation.error }, { status: 400 });
    }

    const { extension, contentType } = audioValidation;

    const durationSeconds = durationSecondsValue
      ? Number(durationSecondsValue)
      : null;

    const parsed = uploadSchema.safeParse({
      organisationId,
      name,
      mediaType,
      durationSeconds
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "Choose an organisation and enter a valid promotional audio type, display name, and optional whole-number duration."
        },
        { status: 400 }
      );
    }

    if (!promoMediaTypes.includes(parsed.data.mediaType)) {
      return NextResponse.json(
        {
          error:
            "Organisation uploads are limited to commercials, jingles, announcements, and voiceovers."
        },
        { status: 403 }
      );
    }

    const access = await requireOrganisationAccess(
      parsed.data.organisationId,
      ORGANISATION_CONTENT_ROLES
    );

    if (!access.ok) {
      return accessDenied(access);
    }

    const organisation = await prisma.organisation.findUnique({
      where: {
        id: parsed.data.organisationId
      },
      include: {
        subscription: {
          include: {
            plan: true
          }
        }
      }
    });

    if (!organisation) {
      return NextResponse.json(
        { error: "The selected organisation was not found." },
        { status: 404 }
      );
    }

    const subscription = organisation.subscription;
    const entitlements = resolveEntitlements(subscription);

    if (!entitlements.serviceEnabled) {
      return NextResponse.json(
        { error: "An active subscription is required to upload promotional audio." },
        { status: 403 }
      );
    }

    if (!entitlements.promoUploadEnabled) {
      return NextResponse.json(
        {
          error:
            "Promotional audio uploads are not included in this organisation's plan."
        },
        { status: 403 }
      );
    }

    const storageLimitBytes =
      BigInt(entitlements.storageLimitGb) * 1024n * 1024n * 1024n;

    const usage = await prisma.mediaAsset.aggregate({
      where: {
        organisationId: organisation.id,
        libraryType: "ORGANISATION_PROMO",
        status: {
          in: ["UPLOADING", "PROCESSING", "READY"]
        }
      },
      _sum: {
        sizeBytes: true
      }
    });

    const usedBytes = usage._sum.sizeBytes || 0n;
    const requestedBytes = BigInt(file.size);

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const storageKey = `organisations/${organisation.id}/promos/${parsed.data.mediaType.toLowerCase()}/${checksum}.${extension}`;
    const quarantineKey = `quarantine/${organisation.id}/${crypto.randomUUID()}.${extension}`;

    const existingAsset = await prisma.mediaAsset.findUnique({
      where: {
        storageKey
      }
    });

    if (existingAsset && existingAsset.organisationId !== organisation.id) {
      return NextResponse.json(
        { error: "This media file belongs to another organisation." },
        { status: 409 }
      );
    }

    const additionalBytes = existingAsset ? 0n : requestedBytes;

    if (usedBytes + additionalBytes > storageLimitBytes) {
      return NextResponse.json(
        {
          error:
            "This promotional upload would exceed the organisation storage limit.",
          usedBytes: usedBytes.toString(),
          limitBytes: storageLimitBytes.toString()
        },
        { status: 413 }
      );
    }

    const mediaAsset = existingAsset
      ? await prisma.mediaAsset.update({
          where: {
            id: existingAsset.id
          },
          data: {
            libraryType: "ORGANISATION_PROMO",
            name: parsed.data.name,
            originalName: file.name,
            mimeType: contentType,
            sizeBytes: requestedBytes,
            durationSeconds: parsed.data.durationSeconds,
            mediaType: parsed.data.mediaType,
            status: "PROCESSING"
          }
        })
      : await prisma.mediaAsset.create({
          data: {
            organisationId: organisation.id,
            libraryType: "ORGANISATION_PROMO",
            name: parsed.data.name,
            originalName: file.name,
            storageKey,
            mimeType: contentType,
            sizeBytes: requestedBytes,
            durationSeconds: parsed.data.durationSeconds,
            mediaType: parsed.data.mediaType,
            status: "PROCESSING"
          }
        });

    try {
      const r2 = getR2Storage();

      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucketName,
          Key: quarantineKey,
          Body: buffer,
          ContentType: contentType,
          Metadata: {
            checksum,
            quarantine: "true"
          }
        })
      );

      await r2.client.send(
        new CopyObjectCommand({
          Bucket: r2.bucketName,
          CopySource: `${r2.bucketName}/${quarantineKey}`,
          Key: storageKey,
          ContentType: contentType,
          MetadataDirective: "REPLACE",
          Metadata: { checksum, quarantine: "false" }
        })
      );

      await r2.client.send(
        new DeleteObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey })
      );

      const readyAsset = await prisma.$transaction(async (tx) => {
        const storedAsset = await tx.mediaAsset.update({
          where: {
            id: mediaAsset.id
          },
          data: {
            status: "READY"
          }
        });

        await tx.auditLog.create({
          data: {
            organisationId: organisation.id,
            actorUserId: user.id,
            action: existingAsset
              ? "MEDIA_ASSET_REPLACED"
              : "MEDIA_ASSET_UPLOADED",
            entityType: "MediaAsset",
            entityId: storedAsset.id,
            details: {
              name: storedAsset.name,
              mediaType: storedAsset.mediaType,
              sizeBytes: storedAsset.sizeBytes.toString(),
              checksum
            }
          }
        });

        return storedAsset;
      });

      return NextResponse.json({
        id: readyAsset.id,
        name: readyAsset.name,
        mediaType: readyAsset.mediaType,
        libraryType: readyAsset.libraryType,
        status: readyAsset.status,
        sizeBytes: readyAsset.sizeBytes.toString()
      });
    } catch (storageError) {
      try {
        const r2 = getR2Storage();
        await r2.client.send(
          new DeleteObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey })
        );
      } catch {
        // The quarantine lifecycle policy is the final cleanup fallback.
      }

      await prisma.mediaAsset.update({
        where: {
          id: mediaAsset.id
        },
        data: {
          status: "REJECTED"
        }
      });

      securityLog("error", "MEDIA_STORAGE_ERROR", request, {
        mediaAssetId: mediaAsset.id,
        error: storageError instanceof Error ? storageError.message : "unknown"
      });

      return NextResponse.json(
        {
          error:
            "The promotional audio file could not be stored. Please try again."
        },
        { status: 502 }
      );
    }
  } catch (error) {
    securityLog("error", "MEDIA_UPLOAD_ERROR", request, {
      error: error instanceof Error ? error.message : "unknown"
    });

    return NextResponse.json(
      { error: "The promotional audio upload could not be completed." },
      { status: 500 }
    );
  }
}
