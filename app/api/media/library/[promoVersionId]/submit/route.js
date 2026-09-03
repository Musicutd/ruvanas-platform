import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import {
  canManageSubscriberAudio,
  prepareSubscriberPromoSubmission
} from "@/lib/subscriber-audio-review.mjs";

export const dynamic = "force-dynamic";

export async function PATCH(_request, { params }) {
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
    if (!entitlements.serviceEnabled || !entitlements.promoUploadEnabled) {
      return NextResponse.json({ error: "Audio review is not available for this service." }, { status: 403 });
    }
    if (!canManageSubscriberAudio(context.membership.role)) {
      return NextResponse.json(
        { error: "An owner, manager or content editor must submit audio for review." },
        { status: 403 }
      );
    }

    const promoVersionId = String(params.promoVersionId || "");
    const version = await prisma.promoVersion.findFirst({
      where: {
        id: promoVersionId,
        promoAsset: { organisationId: organisation.id, status: "ACTIVE" }
      },
      include: {
        promoAsset: { select: { id: true, name: true } },
        mediaAsset: { select: { status: true } },
        processingJobs: { select: { status: true } }
      }
    });
    if (!version) {
      return NextResponse.json({ error: "The audio version was not found." }, { status: 404 });
    }

    let transition;
    try {
      transition = prepareSubscriberPromoSubmission(version);
    } catch (transitionError) {
      return NextResponse.json(
        { error: transitionError instanceof Error ? transitionError.message : "This audio cannot be submitted." },
        { status: 409 }
      );
    }

    const submittedAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.promoVersion.updateMany({
        where: { id: version.id, status: "DRAFT" },
        data: {
          ...transition,
          submittedById: context.user.id,
          submittedAt
        }
      });
      if (changed.count !== 1) throw new Error("SUBMISSION_CONFLICT");

      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: context.user.id,
          action: "SUBSCRIBER_PROMO_VERSION_SUBMITTED",
          entityType: "PromoVersion",
          entityId: version.id,
          details: {
            promoAssetId: version.promoAsset.id,
            name: version.promoAsset.name,
            version: version.version
          }
        }
      });
      return tx.promoVersion.findUnique({ where: { id: version.id } });
    });

    return NextResponse.json({
      version: {
        id: updated.id,
        status: updated.status,
        submittedAt: updated.submittedAt?.toISOString() || null
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SUBMISSION_CONFLICT") {
      return NextResponse.json(
        { error: "This audio was already submitted. Refresh to see its latest status." },
        { status: 409 }
      );
    }
    console.error("Unable to submit subscriber audio:", error);
    return NextResponse.json({ error: "The audio could not be submitted for review." }, { status: 500 });
  }
}
