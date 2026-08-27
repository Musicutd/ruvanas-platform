import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function serializeVersion(version) {
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    qcStatus: version.qcStatus,
    sourceType: version.sourceType,
    sourceReference: version.sourceReference,
    languageCode: version.languageCode,
    checksumSha256: version.checksumSha256,
    loudnessLufs: version.loudnessLufs?.toString() || null,
    durationSeconds:
      version.durationSeconds ?? version.mediaAsset.durationSeconds,
    qcNotes: version.qcNotes,
    submittedAt: version.submittedAt?.toISOString() || null,
    reviewedAt: version.reviewedAt?.toISOString() || null,
    createdAt: version.createdAt.toISOString(),
    mediaAsset: {
      id: version.mediaAsset.id,
      originalName: version.mediaAsset.originalName,
      mimeType: version.mediaAsset.mimeType,
      sizeBytes: version.mediaAsset.sizeBytes.toString(),
      status: version.mediaAsset.status,
      previewUrl: `/api/media/${version.mediaAsset.id}/stream`
    },
    processingJobs: version.processingJobs.map((job) => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      attempts: job.attempts,
      errorMessage: job.errorMessage
    }))
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    let organisationIds = null;

    if (user.role !== "SUPER_ADMIN") {
      const memberships = await prisma.organisationMember.findMany({
        where: { userId: user.id },
        select: { organisationId: true }
      });

      organisationIds = memberships.map((membership) => membership.organisationId);
    }

    const assets = await prisma.promoAsset.findMany({
      where: {
        status: { not: "ARCHIVED" },
        ...(organisationIds
          ? { organisationId: { in: organisationIds } }
          : {})
      },
      include: {
        organisation: { select: { id: true, name: true } },
        versions: {
          orderBy: { version: "desc" },
          include: {
            mediaAsset: true,
            processingJobs: { orderBy: { jobType: "asc" } }
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });

    return NextResponse.json({
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        mediaType: asset.mediaType,
        languageCode: asset.languageCode,
        status: asset.status,
        currentApprovedVersionId: asset.currentApprovedVersionId,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
        organisation: asset.organisation,
        versions: asset.versions.map(serializeVersion)
      }))
    });
  } catch (error) {
    console.error("Unable to load promotional audio:", error);

    return NextResponse.json(
      { error: "Unable to load the promotional library." },
      { status: 500 }
    );
  }
}
