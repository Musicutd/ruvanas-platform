import crypto from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";
import { validateDigitalSignageImage } from "@/lib/digital-signage.mjs";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(asset) {
  return { ...asset, sizeBytes: asset.sizeBytes.toString() };
}

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireDigitalSignageOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const assets = await prisma.digitalSignageAsset.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return NextResponse.json({ assets: assets.map(serialize) });
  } catch (error) {
    console.error("List digital signage assets error:", error);
    return NextResponse.json({ error: "Unable to load visual assets." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    const formData = await request.formData();
    const organisationId = String(formData.get("organisationId") || "").trim();
    const name = String(formData.get("name") || "").trim().slice(0, 200);
    const file = formData.get("file");
    if (!organisationId || !name || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Organisation, display name, and image are required." }, { status: 400 });
    }

    const access = await requireDigitalSignageOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);

    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateDigitalSignageImage({ buffer, fileName: file.name, claimedType: file.type });
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

    const checksumSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const existing = await prisma.digitalSignageAsset.findUnique({
      where: { organisationId_checksumSha256: { organisationId, checksumSha256 } }
    });
    if (existing) return NextResponse.json({ asset: serialize(existing), duplicate: true });

    const [audioUsage, visualUsage] = await Promise.all([
      prisma.mediaAsset.aggregate({
        where: { organisationId, status: { in: ["UPLOADING", "PROCESSING", "READY"] } },
        _sum: { sizeBytes: true }
      }),
      prisma.digitalSignageAsset.aggregate({
        where: { organisationId, status: "READY" },
        _sum: { sizeBytes: true }
      })
    ]);
    const usedBytes = (audioUsage._sum.sizeBytes || 0n) + (visualUsage._sum.sizeBytes || 0n);
    const limitBytes = BigInt(access.entitlements.storageLimitGb) * 1024n * 1024n * 1024n;
    if (usedBytes + BigInt(buffer.length) > limitBytes) {
      return NextResponse.json({ error: "This visual upload would exceed the organisation storage limit." }, { status: 413 });
    }

    const storageKey = `organisations/${organisationId}/signage/images/${checksumSha256}.${validation.extension}`;
    const r2 = getR2Storage();
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucketName,
      Key: storageKey,
      Body: buffer,
      ContentType: validation.mimeType,
      Metadata: { checksum: checksumSha256, mediaKind: "digital-signage-image" }
    }));

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.digitalSignageAsset.create({ data: {
        organisationId,
        name,
        kind: "IMAGE",
        originalName: file.name.slice(0, 255),
        storageKey,
        mimeType: validation.mimeType,
        sizeBytes: BigInt(buffer.length),
        checksumSha256,
        width: validation.width,
        height: validation.height,
        uploadedByUserId: access.user.id
      } });
      await tx.auditLog.create({ data: {
        organisationId,
        actorUserId: access.user.id,
        action: "DIGITAL_SIGNAGE_ASSET_UPLOADED",
        entityType: "DigitalSignageAsset",
        entityId: created.id,
        details: { name, kind: "IMAGE", width: validation.width, height: validation.height, sizeBytes: String(buffer.length), checksumSha256 }
      } });
      return created;
    });
    return NextResponse.json({ asset: serialize(asset) }, { status: 201 });
  } catch (error) {
    console.error("Upload digital signage asset error:", error);
    return NextResponse.json({ error: "Unable to store the visual asset." }, { status: 500 });
  }
}
