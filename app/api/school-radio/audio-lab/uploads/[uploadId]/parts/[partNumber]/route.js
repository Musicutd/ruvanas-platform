import { UploadPartCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { validateUploadPart } from "@/lib/audio-lab.mjs";

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
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const session = await prisma.schoolAudioUploadSession.findFirst({ where: { id: String(params.uploadId || ""), organisationId: access.organisation.id, createdByUserId: access.user.id, status: { in: ["INITIATED", "UPLOADING"] }, expiresAt: { gt: new Date() } } });
  if (!session) return NextResponse.json({ error: "The upload session has expired or is unavailable." }, { status: 404 });

  try {
    const body = await readBoundedBody(request, session.partSizeBytes);
    const partNumber = validateUploadPart({ partNumber: params.partNumber, partCount: session.partCount, sizeBytes: body.length, partSizeBytes: session.partSizeBytes });
    const r2 = getR2Storage();
    const uploaded = await r2.client.send(new UploadPartCommand({ Bucket: r2.bucketName, Key: session.quarantineKey, UploadId: session.multipartUploadId, PartNumber: partNumber, Body: body, ContentLength: body.length }));
    if (!uploaded.ETag) throw new Error("Storage did not confirm the uploaded part.");
    await prisma.$transaction([
      prisma.schoolAudioUploadPart.upsert({ where: { sessionId_partNumber: { sessionId: session.id, partNumber } }, create: { sessionId: session.id, partNumber, eTag: uploaded.ETag, sizeBytes: body.length }, update: { eTag: uploaded.ETag, sizeBytes: body.length } }),
      prisma.schoolAudioUploadSession.update({ where: { id: session.id }, data: { status: "UPLOADING" } })
    ]);
    return NextResponse.json({ partNumber, receivedBytes: body.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The recording part could not be uploaded." }, { status: 400 });
  }
}

