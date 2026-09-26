import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { validateAudioUpload } from "@/lib/audio-validation.mjs";
import { createDefaultEditDecision } from "@/lib/audio-lab.mjs";
import { currentCorrectionsContributorSession, sameOrigin } from "@/lib/corrections-contributor-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await currentCorrectionsContributorSession("RECORD");
  if (!access) return NextResponse.json({ error: "Your supervised Studio session is unavailable." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("recording");
  const durationMs = Number(form?.get("durationMs"));
  if (!(file instanceof File) || file.size < 12 || file.size > MAX_RECORDING_BYTES || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > 12 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "Choose a recording under 50 MB with a valid duration." }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateAudioUpload({ buffer, fileName: file.name, claimedType: file.type });
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const used = await prisma.mediaAsset.aggregate({ where: { organisationId: access.session.organisationId, status: { in: ["UPLOADING", "PROCESSING", "READY"] } }, _sum: { sizeBytes: true } });
  if ((used._sum.sizeBytes || 0n) + BigInt(buffer.length) > BigInt(access.entitlements.storageLimitGb) * 1024n ** 3n) return NextResponse.json({ error: "The organisation storage limit has been reached." }, { status: 413 });
  const r2 = getR2Storage();
  const key = `organisations/${access.session.organisationId}/corrections-studio/${access.session.projectId}/${randomUUID()}.${validation.extension}`;
  const checksum = createHash("sha256").update(buffer).digest("hex");
  try {
    await r2.client.send(new PutObjectCommand({ Bucket: r2.bucketName, Key: key, Body: buffer, ContentLength: buffer.length, ContentType: validation.contentType, Metadata: { source: "corrections-supervised-studio", project: access.session.projectId, checksum } }));
    const take = await prisma.$transaction(async (tx) => {
      const session = await tx.correctionsStudioSession.findFirst({ where: { id: access.session.id, status: "ACTIVE", accessTokenHash: access.session.accessTokenHash, expiresAt: { gt: new Date() }, contributor: { status: "ACTIVE" }, programme: { status: { in: ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] } } } });
      if (!session) throw new Error("Your supervised Studio session has ended.");
      const media = await tx.mediaAsset.create({ data: { organisationId: session.organisationId, libraryType: "ORGANISATION_PROMO", name: file.name.slice(0, 160), originalName: file.name.slice(0, 240), storageKey: key, mimeType: validation.contentType, sizeBytes: BigInt(buffer.length), durationSeconds: Math.max(1, Math.round(durationMs / 1000)), mediaType: "ANNOUNCEMENT", status: "READY" } });
      const created = await tx.audioTake.create({ data: { organisationId: session.organisationId, projectId: session.projectId, mediaAssetId: media.id, recordedByUserId: session.supervisorUserId, durationMs, status: "READY", sourceEditDecision: createDefaultEditDecision() } });
      await tx.audioProject.update({ where: { id: session.projectId }, data: { status: "READY" } });
      await tx.auditLog.create({ data: { organisationId: session.organisationId, action: "CORRECTIONS_STUDIO_RECORDING_CREATED", entityType: "AudioTake", entityId: created.id, details: { sessionId: session.id, facilityId: session.facilityId, contributorId: session.contributorId, projectId: session.projectId, checksum } } });
      return created;
    });
    return NextResponse.json({ ok: true, takeId: take.id }, { status: 201 });
  } catch (error) {
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: key })).catch(() => {});
    return NextResponse.json({ error: error.message || "The recording could not be stored." }, { status: 409 });
  }
}
