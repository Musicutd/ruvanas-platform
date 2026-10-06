import { AbortMultipartUploadCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveStudio } from "@/lib/studio-access";
import { validateUploadPart } from "@/lib/audio-lab.mjs";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, assertGeneralStudioAudioProject, lockGeneralStudioAudioProject } from "@/lib/studio-general-asset-boundary.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readBoundedBody(request, maximumBytes) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) throw new Error("The upload part exceeds the 5 MB limit.");
  if (!request.body) throw new Error("The upload part is empty.");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("The upload part exceeds the 5 MB limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function PUT(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { uploadId, partNumber: requestedPartNumber } = await params;
  const session = await prisma.schoolAudioUploadSession.findFirst({ where: { id: String(uploadId || ""), organisationId: access.organisation.id, createdByUserId: access.user.id, status: { in: ["INITIATED", "UPLOADING"] }, expiresAt: { gt: new Date() }, project: { is: GENERAL_STUDIO_AUDIO_PROJECT_WHERE } } });
  if (!session) return NextResponse.json({ error: "The upload session has expired or is unavailable." }, { status: 404 });

  try {
    const body = await readBoundedBody(request, session.partSizeBytes);
    await assertGeneralStudioAudioProject(prisma, access.organisation.id, session.projectId);
    const partNumber = validateUploadPart({ partNumber: requestedPartNumber, partCount: session.partCount, sizeBytes: body.length, partSizeBytes: session.partSizeBytes });
    const r2 = getR2Storage();
    const uploaded = await r2.client.send(new UploadPartCommand({ Bucket: r2.bucketName, Key: session.quarantineKey, UploadId: session.multipartUploadId, PartNumber: partNumber, Body: body, ContentLength: body.length }));
    if (!uploaded.ETag) throw new Error("Storage did not confirm the uploaded part.");
    await prisma.$transaction(async (tx) => {
      await lockGeneralStudioAudioProject(tx, access.organisation.id, session.projectId);
      const currentSession = await tx.schoolAudioUploadSession.findFirst({ where: {
        id: session.id, organisationId: access.organisation.id, createdByUserId: access.user.id,
        status: { in: ["INITIATED", "UPLOADING"] }, expiresAt: { gt: new Date() }
      }, select: { id: true } });
      if (!currentSession) throw new Error("The upload session has expired or is unavailable.");
      await tx.schoolAudioUploadPart.upsert({ where: { sessionId_partNumber: { sessionId: session.id, partNumber } }, create: { sessionId: session.id, partNumber, eTag: uploaded.ETag, sizeBytes: body.length }, update: { eTag: uploaded.ETag, sizeBytes: body.length } });
      await tx.schoolAudioUploadSession.update({ where: { id: session.id }, data: { status: "UPLOADING" } });
    });
    return NextResponse.json({ partNumber, receivedBytes: body.length });
  } catch (error) {
    if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") {
      // The private transition makes this multipart session unusable. Release its quota
      // reservation without changing the project or its submitted render evidence.
      await prisma.schoolAudioUploadSession.updateMany({ where: {
        id: session.id, organisationId: access.organisation.id, createdByUserId: access.user.id,
        status: { in: ["INITIATED", "UPLOADING"] }
      }, data: { status: "FAILED" } }).catch(() => {});
      try {
        const r2 = getR2Storage();
        await r2.client.send(new AbortMultipartUploadCommand({ Bucket: r2.bucketName, Key: session.quarantineKey, UploadId: session.multipartUploadId }));
      } catch {}
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "The recording part could not be uploaded." }, { status: error?.status || 400 });
  }
}

