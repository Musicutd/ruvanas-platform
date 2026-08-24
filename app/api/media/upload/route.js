import crypto from "crypto";
import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { getCurrentUser } from "@/lib/auth";

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

const supportedExtensions = new Map([
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["m4a", "audio/mp4"]
]);

function getExtension(fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  return extension && supportedExtensions.has(extension) ? extension : null;
}

function getContentType(file, extension) {
  if (file.type && file.type.startsWith("audio/")) {
    return file.type;
  }

  return supportedExtensions.get(extension) || "application/octet-stream";
}

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

    const extension = getExtension(file.name);

    if (!extension) {
      return NextResponse.json(
        { error: "Unsupported file type. Use MP3, WAV, OGG, or M4A." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "The file exceeds the 50 MB upload limit." },
        { status: 413 }
      );
    }

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

    let organisation;

    if (user.role === "SUPER_ADMIN") {
      organisation = await prisma.organisation.findUnique({
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
    } else {
      const membership = await prisma.organisationMember.findFirst({
        where: {
          userId: user.id,
          organisationId: parsed.data.organisationId
        },
        include: {
          organisation: {
            include: {
              subscription: {
                include: {
                  plan: true
                }
              }
            }
          }
        }
      });

      organisation = membership?.organisation || null;
    }

    if (!organisation) {
      return NextResponse.json(
        {
          error:
            "You do not have permission to upload promotional audio for this organisation."
        },
        { status: 403 }
      );
    }

    const subscription = organisation.subscription;

    if (!subscription || !subscription.plan) {
      return NextResponse.json(
        { error: "The organisation does not have a storage plan configured." },
        { status: 403 }
      );
    }

    if (!subscription.plan.promoUploadEnabled) {
      return NextResponse.json(
        {
          error:
            "Promotional audio uploads are not included in this organisation's plan."
        },
        { status: 403 }
      );
    }

    const storageLimitBytes =
      BigInt(subscription.plan.storageLimitGb) * 1024n * 1024n * 1024n;

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const storageKey = `organisations/${organisation.id}/promos/${parsed.data.mediaType.toLowerCase()}/${checksum}.${extension}`;
    const contentType = getContentType(file, extension);

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
            status: "UPLOADING"
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
            status: "UPLOADING"
          }
        });

    try {
      const r2 = getR2Storage();

      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucketName,
          Key: storageKey,
          Body: buffer,
          ContentType: contentType
        })
      );

      const readyAsset = await prisma.mediaAsset.update({
        where: {
          id: mediaAsset.id
        },
        data: {
          status: "READY"
        }
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
      await prisma.mediaAsset.update({
        where: {
          id: mediaAsset.id
        },
        data: {
          status: "REJECTED"
        }
      });

      console.error("Cloudflare R2 promotional upload failed:", storageError);

      return NextResponse.json(
        {
          error:
            "The promotional audio file could not be stored. Please try again."
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("Promotional audio upload request failed:", error);

    return NextResponse.json(
      { error: "The promotional audio upload could not be completed." },
      { status: 500 }
    );
  }
}
