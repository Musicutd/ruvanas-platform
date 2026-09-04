import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { musicRightsWindowIsCurrent } from "@/lib/media-library-pro.mjs";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().trim().max(2000).optional().nullable()
}).superRefine((value, context) => {
  if (value.decision === "REJECT" && !value.notes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Add a clear reason when requesting changes." });
  }
});

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can review music rights." }, { status: 403 });
    }
    const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Choose an approval decision." }, { status: 400 });
    }

    const { trackId } = await params;
    const track = await prisma.track.findFirst({
      where: { id: trackId, mediaAsset: { libraryType: "ORGANISATION_MUSIC", status: "READY" } },
      include: { mediaAsset: true }
    });
    if (!track) return NextResponse.json({ error: "The organisation music track was not found." }, { status: 404 });
    if (track.rightsReviewStatus !== "IN_REVIEW") {
      return NextResponse.json({ error: "Only submitted music can be reviewed." }, { status: 409 });
    }
    if (parsed.data.decision === "APPROVE" && !musicRightsWindowIsCurrent(track)) {
      return NextResponse.json({ error: "The declared licence window is not currently active." }, { status: 400 });
    }

    const approved = parsed.data.decision === "APPROVE";
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.track.update({
        where: { id: track.id },
        data: {
          status: approved ? "READY" : "DRAFT",
          rightsReviewStatus: approved ? "APPROVED" : "REJECTED",
          rightsReviewNotes: parsed.data.notes || null,
          rightsReviewedAt: new Date(),
          rightsReviewedById: access.user.id
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: track.mediaAsset.organisationId,
          actorUserId: access.user.id,
          action: approved ? "ORGANISATION_MUSIC_RIGHTS_APPROVED" : "ORGANISATION_MUSIC_RIGHTS_REJECTED",
          entityType: "Track",
          entityId: track.id,
          details: {
            rightsBasis: track.rightsBasis,
            permittedUses: track.permittedUses,
            permittedTerritories: track.permittedTerritories,
            notes: parsed.data.notes || null
          }
        }
      });
      return saved;
    });

    return NextResponse.json({ ok: true, status: updated.status, rightsReviewStatus: updated.rightsReviewStatus });
  } catch (error) {
    console.error("Organisation music rights review error:", error);
    return NextResponse.json({ error: "The music rights decision could not be saved." }, { status: 500 });
  }
}
