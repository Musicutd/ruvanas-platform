import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  ORGANISATION_CONTENT_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"])
});

export async function PATCH(request, { params }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    const promoAssetId = String(params.promoAssetId || "");
    const parsed = statusSchema.safeParse(await request.json());

    if (!promoAssetId || !parsed.success) {
      return NextResponse.json(
        { error: "Choose a valid promotional asset status." },
        { status: 400 }
      );
    }

    const promoAsset = await prisma.promoAsset.findUnique({
      where: { id: promoAssetId }
    });

    if (!promoAsset) {
      return NextResponse.json(
        { error: "The promotional asset was not found." },
        { status: 404 }
      );
    }

    const access = await requireOrganisationAccess(
      promoAsset.organisationId,
      ORGANISATION_CONTENT_ROLES
    );

    if (!access.ok) {
      return accessDenied(access);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const asset = await tx.promoAsset.update({
        where: { id: promoAssetId },
        data: { status: parsed.data.status }
      });

      await tx.auditLog.create({
        data: {
          organisationId: promoAsset.organisationId,
          actorUserId: access.user.id,
          action:
            parsed.data.status === "ARCHIVED"
              ? "PROMO_ASSET_ARCHIVED"
              : "PROMO_ASSET_RESTORED",
          entityType: "PromoAsset",
          entityId: promoAssetId,
          details: { name: promoAsset.name }
        }
      });

      return asset;
    });

    return NextResponse.json({
      asset: { id: updated.id, status: updated.status }
    });
  } catch (error) {
    console.error("Unable to update promotional asset status:", error);
    return NextResponse.json(
      { error: "The promotional asset status could not be updated." },
      { status: 500 }
    );
  }
}
