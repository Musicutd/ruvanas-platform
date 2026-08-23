import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, r2BucketName } from "@/lib/r2";
import { prisma } from "@/lib/prisma";
import { authFromRequest } from "@/lib/auth";
import { z } from "zod";

const uploadSchema = z.object({
  organisationId: z.string().cuid(),
  name: z.string().min(1).max(200),
  mediaType: z.enum(["MUSIC", "COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"]),
  durationSeconds: z.number().int().positive().nullable().optional()
});

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

function getContentType(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

export async function POST(request) {
  try {
    const auth = await authFromRequest(request);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const { user, organisation } = auth;

    const formData = await request.formData();
    const file = formData.get("file");
    const organisationId = formData.get("organisationId");
    const name = formData.get("name");
    const mediaType = formData.get("mediaType");
    const durationSecondsRaw = formData.get("durationSeconds");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    const parsed = uploadSchema.safeParse({
      organisationId,
      name,
      mediaType,
      durationSeconds: durationSecondsRaw
        ? Number(durationSecondsRaw)
        : null
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid upload metadata", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name: safeName, mediaType: safeMediaType, durationSeconds } =
      parsed.data;

    if (organisationId !== organisation.id) {
      return NextResponse.json(
        { error: "Organisation mismatch" },
        { status: 403 }
      );
    }

    const fileBytes = BigInt(file.size);
    if (fileBytes > BigInt(MAX_FILE_SIZE_BYTES)) {
      return NextResponse.json(
        {
          error: "File too large",
          maxBytes: MAX_FILE_SIZE_BYTES
        },
        { status: 413 }
      );
    }

    const subscription = await prisma.subscription.findUnique({
      where: { organisationId: organisation.id },
      include: { plan: true }
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 403 }
      );
    }

    const storageLimitBytes = BigInt(subscription.plan.storageLimitGb) * BigInt(1024 * 1024 * 1024);

    const currentUsage = await prisma.mediaAsset.aggregate({
      where: {
        organisationId: organisation.id,
        status: {
          in: ["READY", "PROCESSING", "UPLOADING"]
        }
      },
      _sum: {
        sizeBytes: true
      }
    });

    const currentUsageBytes = (currentUsage._sum.sizeBytes ?? BigInt(0)) + fileBytes;

    if (currentUsageBytes > storageLimitBytes) {
      return NextResponse.json(
        {
          error: "Storage limit exceeded",
          usedBytes: currentUsageBytes.toString(),
          limitBytes: storageLimitBytes.toString()
        },
        { status: 413 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileHash = await crypto.subtle.digest(
      "SHA-256",
      fileBuffer
    );
    const hashHex = Array.from(new Uint8Array(fileHash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const ext = file.name.split(".").pop() || "bin";
    const storageKey = `org_${organisation.id}/${safeMediaType.toLowerCase()}/${hashHex}.${ext}`;
    const contentType = getContentType(file.name);

    await r2Client.send(
      new PutObjectCommand({
        Bucket: r2BucketName,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: contentType
      })
    );

    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        organisationId: organisation.id,
        name: safeName,
        originalName: file.name,
        storageKey,
        mimeType: contentType,
        sizeBytes: fileBytes,
        durationSeconds: durationSeconds ?? null,
        mediaType: safeMediaType,
        status: "READY"
      }
    });

    const publicUrl = `/api/media/stream/${mediaAsset.id}`;

    return NextResponse.json({
      id: mediaAsset.id,
      name: mediaAsset.name,
      mediaType: mediaAsset.mediaType,
      sizeBytes: mediaAsset.sizeBytes.toString(),
      durationSeconds: mediaAsset.durationSeconds,
      url: publicUrl
    });
  } catch (error) {
    console.error("Media upload error", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
