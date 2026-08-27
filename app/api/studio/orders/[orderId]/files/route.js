import crypto from "crypto";
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { productionPermissions } from "@/lib/production-orders.mjs";
import { requireActiveStudio } from "@/lib/studio-access";
import { validateStudioFile } from "@/lib/studio-files.mjs";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const permissions = productionPermissions({ platformRole: access.user.role, membershipRole: access.membership.role });
  const formData = await request.formData();
  const file = formData.get("file");
  const kind = String(formData.get("kind") || "");
  if (!file || !(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file before uploading." }, { status: 400 });

  const order = await prisma.productionOrder.findFirst({
    where: { id: String(params.orderId || ""), organisationId: access.organisation.id },
    select: { id: true, status: true }
  });
  if (!order) return NextResponse.json({ error: "The production order was not found." }, { status: 404 });
  if (kind === "BRIEF_ATTACHMENT") {
    if (!permissions.canCreate) return NextResponse.json({ error: "You cannot add brief attachments." }, { status: 403 });
    if (["DELIVERED", "CANCELLED"].includes(order.status)) return NextResponse.json({ error: "Files cannot be added to a completed order." }, { status: 409 });
  } else {
    if (!permissions.canProduce) return NextResponse.json({ error: "Only Ruvanas production staff can upload Studio audio." }, { status: 403 });
    if (kind === "AUDIO_PREVIEW" && !["IN_PRODUCTION", "AWAITING_CUSTOMER_APPROVAL", "CHANGES_REQUESTED"].includes(order.status)) return NextResponse.json({ error: "Audio previews can be uploaded only during production or review." }, { status: 409 });
    if (kind === "FINAL_MASTER" && order.status !== "APPROVED") return NextResponse.json({ error: "A final master can be uploaded only after customer approval." }, { status: 409 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateStudioFile({ buffer, fileName: file.name, claimedType: file.type, kind });
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: buffer.length > 50 * 1024 * 1024 ? 413 : 400 });

  const checksumSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const token = crypto.randomUUID();
  const storageKey = `organisations/${access.organisation.id}/studio/${order.id}/${kind.toLowerCase()}/${token}.${validation.extension}`;
  const quarantineKey = `quarantine/${access.organisation.id}/studio/${token}.${validation.extension}`;
  const r2 = getR2Storage();
  try {
    await r2.client.send(new PutObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey, Body: buffer, ContentType: validation.contentType, Metadata: { checksum: checksumSha256, quarantine: "true" } }));
    await r2.client.send(new CopyObjectCommand({ Bucket: r2.bucketName, CopySource: `${r2.bucketName}/${quarantineKey}`, Key: storageKey, ContentType: validation.contentType, MetadataDirective: "REPLACE", Metadata: { checksum: checksumSha256, quarantine: "false" } }));
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey }));

    const stored = await prisma.$transaction(async (tx) => {
      const created = await tx.productionOrderFile.create({
        data: { organisationId: access.organisation.id, orderId: order.id, uploadedByUserId: access.user.id, kind, originalName: file.name.slice(0, 240), storageKey, mimeType: validation.contentType, sizeBytes: BigInt(file.size), checksumSha256 },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } }
      });
      await tx.productionOrderEvent.create({
        data: { organisationId: access.organisation.id, orderId: order.id, actorUserId: access.user.id, eventType: "FILE_ADDED", note: `${kind.replaceAll("_", " ")} added: ${created.originalName}` }
      });
      await tx.auditLog.create({
        data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "PRODUCTION_ORDER_FILE_ADDED", entityType: "ProductionOrderFile", entityId: created.id, details: { orderId: order.id, kind, mimeType: created.mimeType, sizeBytes: created.sizeBytes.toString(), checksumSha256 } }
      });
      return created;
    });
    const { storageKey: _storageKey, sizeBytes, ...safe } = stored;
    return NextResponse.json({ file: { ...safe, sizeBytes: sizeBytes.toString() } }, { status: 201 });
  } catch (error) {
    try { await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: quarantineKey })); } catch {}
    try { await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: storageKey })); } catch {}
    console.error("Studio file upload failed:", error);
    return NextResponse.json({ error: "The Studio file could not be stored. Please try again." }, { status: 502 });
  }
}

