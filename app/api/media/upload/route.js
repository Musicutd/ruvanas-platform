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
import {
  buildPromoProcessingJobs,
  nextPromoVersionNumber,
  normalizePromoLanguageCode
} from "@/lib/promo-versioning.mjs";
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
  promoAssetId: z.string().min(1).max(100).nullable(),
  name: z.string().trim().min(1).max(200),
  mediaType: z.enum([
    "COMMERCIAL",
    "JINGLE",
    "ANNOUNCEMENT",
    "VOICEOVER"
  ]),
  durationSeconds: z.number().int().positive().nullable(),
  languageCode: z.string().trim().max(35)
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
    const promoAssetId = String(formData.get("promoAssetId") || "").trim() || null;
    const languageCodeValue = String(formData.get("languageCode") || "und");
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
      promoAssetId,
      name,
      mediaType,
      durationSeconds,
      languageCode: languageCodeValue
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

    let languageCode;

    try {
      languageCode = normalizePromoLanguageCode(parsed.data.languageCode);
    } catch (languageError) {
      return NextResponse.json(
        {
          error:
            languageError instanceof Error
              ? languageError.message
              : "Enter a valid promotional audio language."
        },
        { status: 400 }
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
            plan: true,
            billingContract: true
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

    const requestedPromoAsset = parsed.data.promoAssetId
      ? await prisma.promoAsset.findUnique({
          where: { id: parsed.data.promoAssetId },
          include: {
            versions: {
              select: { version: true }
            }
          }
        })
      : null;

    if (parsed.data.promoAssetId && !requestedPromoAsset) {
      return NextResponse.json(
        { error: "The promotional asset was not found." },
        { status: 404 }
      );
    }

    if (
      requestedPromoAsset &&
      (requestedPromoAsset.organisationId !== organisation.id ||
        requestedPromoAsset.status !== "ACTIVE")
    ) {
      return NextResponse.json(
        { error: "This promotional asset is not available to this organisation." },
        { status: 403 }
      );
    }

    if (
      requestedPromoAsset &&
      requestedPromoAsset.mediaType !== parsed.data.mediaType
    ) {
      return NextResponse.json(
        { error: "A new version must keep the promotional asset's audio type." },
        { status: 400 }
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

    const mediaAsset = existingAsset?.status === "READY"
      ? existingAsset
      : existingAsset
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

    const needsStorageWrite = !existingAsset || existingAsset.status !== "READY";

    try {
      if (needsStorageWrite) {
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
      }

      const result = await prisma.$transaction(async (tx) => {
        const storedAsset = needsStorageWrite
          ? await tx.mediaAsset.update({
              where: { id: mediaAsset.id },
              data: { status: "READY" }
            })
          : mediaAsset;

        const promoAsset = requestedPromoAsset
          ? requestedPromoAsset
          : await tx.promoAsset.create({
              data: {
                organisationId: organisation.id,
                name: parsed.data.name,
                mediaType: parsed.data.mediaType,
                languageCode
              }
            });

        const versionNumber = requestedPromoAsset
          ? nextPromoVersionNumber(requestedPromoAsset.versions)
          : 1;

        const promoVersion = await tx.promoVersion.create({
          data: {
            promoAssetId: promoAsset.id,
            mediaAssetId: storedAsset.id,
            version: versionNumber,
            status: "DRAFT",
            qcStatus: "PENDING",
            sourceType: "UPLOAD",
            languageCode,
            checksumSha256: checksum,
            durationSeconds: parsed.data.durationSeconds,
            processingJobs: {
              create: buildPromoProcessingJobs()
            }
          }
        });

        await tx.auditLog.create({
          data: {
            organisationId: organisation.id,
            actorUserId: user.id,
            action: "PROMO_VERSION_UPLOADED",
            entityType: "PromoVersion",
            entityId: promoVersion.id,
            details: {
              promoAssetId: promoAsset.id,
              name: promoAsset.name,
              version: promoVersion.version,
              mediaType: promoAsset.mediaType,
              languageCode,
              sizeBytes: storedAsset.sizeBytes.toString(),
              checksum,
              status: "DRAFT"
            }
          }
        });

        return { storedAsset, promoAsset, promoVersion };
      });

      return NextResponse.json({
        id: result.storedAsset.id,
        promoAssetId: result.promoAsset.id,
        promoVersionId: result.promoVersion.id,
        version: result.promoVersion.version,
        name: result.promoAsset.name,
        mediaType: result.promoAsset.mediaType,
        languageCode: result.promoVersion.languageCode,
        libraryType: result.storedAsset.libraryType,
        status: result.promoVersion.status,
        sizeBytes: result.storedAsset.sizeBytes.toString(),
        durationSeconds: result.promoVersion.durationSeconds,
        url: `/api/media/${result.storedAsset.id}/stream`
      });
    } catch (storageError) {
      if (needsStorageWrite) {
        try {
          const r2 = getR2Storage();
          await r2.client.send(
            new DeleteObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey })
          );
        } catch {
          // The quarantine lifecycle policy is the final cleanup fallback.
        }
      }

      if (needsStorageWrite) {
        await prisma.mediaAsset.update({
          where: { id: mediaAsset.id },
          data: { status: "REJECTED" }
        });
      }

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

