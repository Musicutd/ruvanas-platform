import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import {
  canManageSubscriberAudio,
  subscriberAudioReviewState
} from "@/lib/subscriber-audio-review.mjs";

export const dynamic = "force-dynamic";

function serializeVersion(version) {
  const review = subscriberAudioReviewState(version);
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    qcStatus: version.qcStatus,
    qcNotes: version.qcNotes,
    languageCode: version.languageCode,
    durationSeconds: version.durationSeconds ?? version.mediaAsset.durationSeconds,
    submittedAt: version.submittedAt?.toISOString() || null,
    reviewedAt: version.reviewedAt?.toISOString() || null,
    createdAt: version.createdAt.toISOString(),
    previewUrl: `/api/media/${version.mediaAsset.id}/stream`,
    file: {
      name: version.mediaAsset.originalName,
      sizeBytes: version.mediaAsset.sizeBytes.toString(),
      status: version.mediaAsset.status
    },
    processingJobs: version.processingJobs.map((job) => ({
      type: job.jobType,
      status: job.status,
      errorMessage: job.errorMessage
    })),
    review
  };
}

export async function GET() {
  try {
    const context = await getActiveOrganisationContext({
      subscription: { include: { plan: true, billingContract: true } }
    });

    if (!context) {
      return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    }
    if (!context.membership) {
      return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    }

    const organisation = context.membership.organisation;
    const entitlements = resolveEntitlements(organisation.subscription);
    if (!entitlements.serviceEnabled) {
      return NextResponse.json(
        { error: "The audio library is unavailable while this service is inactive." },
        { status: 403 }
      );
    }

    const assets = await prisma.promoAsset.findMany({
      where: { organisationId: organisation.id, status: { not: "ARCHIVED" } },
      include: {
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
      organisation: { id: organisation.id, name: organisation.name },
      permissions: {
        canUpload: entitlements.promoUploadEnabled && canManageSubscriberAudio(context.membership.role),
        canSubmit: entitlements.promoUploadEnabled && canManageSubscriberAudio(context.membership.role),
        role: context.membership.role
      },
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        mediaType: asset.mediaType,
        languageCode: asset.languageCode,
        currentApprovedVersionId: asset.currentApprovedVersionId,
        updatedAt: asset.updatedAt.toISOString(),
        versions: asset.versions.map(serializeVersion)
      }))
    });
  } catch (error) {
    console.error("Unable to load subscriber audio library:", error);
    return NextResponse.json({ error: "Unable to load the audio library." }, { status: 500 });
  }
}
