import crypto from "crypto";
import { CreateMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { AUDIO_LAB_UPLOAD_TTL_MS, validateAudioLabUpload } from "@/lib/audio-lab.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  projectId: z.string().cuid(),
  originalName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive()
});

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The recording upload details are invalid." }, { status: 400 });

  let upload;
  let quarantineKey;
  try {
    const settings = validateAudioLabUpload(parsed.data);
    const project = await prisma.audioProject.findFirst({ where: { id: parsed.data.projectId, organisationId: access.organisation.id, status: { in: ["DRAFT", "RECORDING", "READY"] } }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "The AudioLab project was not found or cannot accept another take." }, { status: 404 });

    const storageLimitBytes = BigInt(access.entitlements.storageLimitGb) * 1024n * 1024n * 1024n;
    const [mediaUsage, pendingUsage] = await Promise.all([
      prisma.mediaAsset.aggregate({ where: { organisationId: access.organisation.id, status: { in: ["UPLOADING", "PROCESSING", "READY"] } }, _sum: { sizeBytes: true } }),
      prisma.schoolAudioUploadSession.aggregate({ where: { organisationId: access.organisation.id, status: { in: ["INITIATED", "UPLOADING", "COMPLETING"] } }, _sum: { expectedSizeBytes: true } })
    ]);
    if ((mediaUsage._sum.sizeBytes || 0n) + (pendingUsage._sum.expectedSizeBytes || 0n) + BigInt(parsed.data.sizeBytes) > storageLimitBytes) {
      return NextResponse.json({ error: "This recording would exceed the organisation storage limit." }, { status: 413 });
    }

    quarantineKey = `quarantine/${access.organisation.id}/audio-lab/${project.id}/${crypto.randomUUID()}.${settings.extension}`;
    const r2 = getR2Storage();
    upload = await r2.client.send(new CreateMultipartUploadCommand({
      Bucket: r2.bucketName,
      Key: quarantineKey,
      ContentType: settings.mimeType,
      Metadata: { quarantine: "true", project: project.id }
    }));
    if (!upload.UploadId) throw new Error("Storage did not create a resumable upload session.");

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.schoolAudioUploadSession.create({
        data: {
          organisationId: access.organisation.id,
          projectId: project.id,
          originalName: parsed.data.originalName,
          mimeType: settings.mimeType,
          expectedSizeBytes: BigInt(parsed.data.sizeBytes),
          partSizeBytes: settings.partSizeBytes,
          partCount: settings.partCount,
          quarantineKey,
          multipartUploadId: upload.UploadId,
          createdByUserId: access.user.id,
          expiresAt: new Date(Date.now() + AUDIO_LAB_UPLOAD_TTL_MS)
        }
      });
      await tx.audioProject.update({ where: { id: project.id }, data: { status: "UPLOADING" } });
      return created;
    });
    return NextResponse.json({ uploadId: session.id, partSizeBytes: session.partSizeBytes, partCount: session.partCount, expiresAt: session.expiresAt }, { status: 201 });
  } catch (error) {
    if (upload?.UploadId && quarantineKey) {
      try {
        const r2 = getR2Storage();
        await r2.client.send(new AbortMultipartUploadCommand({ Bucket: r2.bucketName, Key: quarantineKey, UploadId: upload.UploadId }));
      } catch {}
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "The resumable upload could not be started." }, { status: 500 });
  }
}

