import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canManageSubscriberAudio } from "@/lib/subscriber-audio-review.mjs";
import { prepareMusicRightsSubmission } from "@/lib/media-library-pro.mjs";

export const dynamic = "force-dynamic";

export async function PATCH(_request, { params }) {
  try {
    const context = await getActiveOrganisationContext({
      subscription: { include: { plan: true, billingContract: true } }
    });
    if (!context) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
      return NextResponse.json({ error: "The music library is unavailable while this service is inactive." }, { status: 403 });
    }
    if (!canManageSubscriberAudio(context.membership.role)) {
      return NextResponse.json({ error: "An organisation owner, manager or content editor must submit music." }, { status: 403 });
    }

    const { trackId } = await params;
    const track = await prisma.track.findFirst({
      where: {
        id: trackId,
        mediaAsset: {
          organisationId: context.membership.organisationId,
          libraryType: "ORGANISATION_MUSIC",
          status: "READY"
        }
      },
      include: { mediaAsset: true }
    });
    if (!track) return NextResponse.json({ error: "The music track was not found in your organisation." }, { status: 404 });

    let transition;
    try {
      transition = prepareMusicRightsSubmission(track);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.track.update({ where: { id: track.id }, data: transition });
      await tx.auditLog.create({
        data: {
          organisationId: context.membership.organisationId,
          actorUserId: context.user.id,
          action: "ORGANISATION_MUSIC_RIGHTS_SUBMITTED",
          entityType: "Track",
          entityId: track.id,
          details: {
            rightsBasis: track.rightsBasis,
            permittedUses: track.permittedUses,
            permittedTerritories: track.permittedTerritories,
            licenceStartsAt: track.licenceStartsAt?.toISOString() || null,
            licenceExpiresAt: track.licenceExpiresAt?.toISOString() || null
          }
        }
      });
      return saved;
    });

    return NextResponse.json({ ok: true, rightsReviewStatus: updated.rightsReviewStatus });
  } catch (error) {
    console.error("Organisation music rights submission error:", error);
    return NextResponse.json({ error: "The music could not be submitted for review." }, { status: 500 });
  }
}
