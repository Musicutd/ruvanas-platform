import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";
import { normaliseRetailMediaOrder, RETAIL_MEDIA_REPORTING_NOTICE } from "@/lib/retail-media.mjs";

export const dynamic = "force-dynamic";

function orderInclude() {
  return {
    advertiser: { select: { id: true, name: true, status: true } },
    agency: { select: { id: true, name: true, status: true } },
    inventoryPackage: { select: { id: true, name: true, status: true, maxPlays: true, effectiveFrom: true, effectiveTo: true } },
    campaign: { select: { id: true, name: true, status: true } },
    approvedBy: { select: { id: true, name: true, email: true } },
    creatives: {
      include: {
        promoVersion: { select: { id: true, version: true, status: true, promoAsset: { select: { id: true, name: true, organisationId: true } } } },
        reviewedBy: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: "asc" }
    },
    visualCreatives: {
      include: {
        signageAsset: { select: { id: true, name: true, status: true, kind: true, width: true, height: true, organisationId: true } },
        reviewedBy: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: "asc" }
    },
    visualPlaylists: { select: { id: true, name: true, status: true, version: true } }
  };
}

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireRetailMediaOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const orders = await prisma.retailMediaOrder.findMany({ where: { organisationId }, include: orderInclude(), orderBy: { createdAt: "desc" } });
    return NextResponse.json({ orders, reportingNotice: RETAIL_MEDIA_REPORTING_NOTICE });
  } catch (error) {
    console.error("List retail-media orders error:", error);
    return NextResponse.json({ error: "Unable to load retail-media orders." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    let input;
    try { input = normaliseRetailMediaOrder(await request.json()); }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const access = await requireRetailMediaOrganisation(input.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);

    const [advertiser, agency, inventoryPackage, creatives, visualCreatives, campaign] = await Promise.all([
      prisma.retailMediaPartner.findFirst({ where: { id: input.advertiserId, organisationId: input.organisationId, kind: "ADVERTISER", status: "ACTIVE" } }),
      input.agencyId ? prisma.retailMediaPartner.findFirst({ where: { id: input.agencyId, organisationId: input.organisationId, kind: "AGENCY", status: "ACTIVE" } }) : null,
      prisma.retailMediaInventoryPackage.findFirst({ where: { id: input.inventoryPackageId, organisationId: input.organisationId, status: { not: "ARCHIVED" } } }),
      prisma.promoVersion.findMany({ where: { id: { in: input.creativePromoVersionIds }, status: "APPROVED", promoAsset: { organisationId: input.organisationId, status: "ACTIVE" }, mediaAsset: { status: "READY" } }, select: { id: true } }),
      prisma.digitalSignageAsset.findMany({ where: { id: { in: input.visualAssetIds }, organisationId: input.organisationId, status: "READY" }, select: { id: true } }),
      input.campaignId ? prisma.campaign.findFirst({ where: { id: input.campaignId, organisationId: input.organisationId, status: "DRAFT", retailMediaOrder: null }, select: { id: true, promoVersionId: true } }) : null
    ]);
    if (!advertiser) return NextResponse.json({ error: "Choose an active advertiser from this organisation." }, { status: 400 });
    if (input.agencyId && !agency) return NextResponse.json({ error: "Choose an active agency from this organisation." }, { status: 400 });
    if (!inventoryPackage) return NextResponse.json({ error: "Choose an available inventory package from this organisation." }, { status: 400 });
    if (creatives.length !== input.creativePromoVersionIds.length) return NextResponse.json({ error: "Every creative must be an approved, ready promo version owned by this organisation." }, { status: 400 });
    if (visualCreatives.length !== input.visualAssetIds.length) return NextResponse.json({ error: "Every visual creative must be a ready signage asset owned by this organisation." }, { status: 400 });
    if (input.campaignId && !campaign) return NextResponse.json({ error: "Choose an unlinked campaign draft from this organisation." }, { status: 400 });
    if (campaign && !input.creativePromoVersionIds.includes(campaign.promoVersionId)) {
      return NextResponse.json({ error: "The linked campaign creative must be included in the order." }, { status: 400 });
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.retailMediaOrder.create({
        data: {
          organisationId: input.organisationId,
          advertiserId: input.advertiserId,
          agencyId: input.agencyId,
          inventoryPackageId: input.inventoryPackageId,
          campaignId: input.campaignId,
          name: input.name,
          purchaseOrderReference: input.purchaseOrderReference,
          creatives: { create: input.creativePromoVersionIds.map((promoVersionId) => ({ promoVersionId })) },
          visualCreatives: { create: input.visualAssetIds.map((signageAssetId) => ({ signageAssetId })) }
        },
        include: orderInclude()
      });
      await tx.auditLog.create({ data: {
        organisationId: input.organisationId,
        actorUserId: access.user.id,
        action: "RETAIL_MEDIA_ORDER_CREATED",
        entityType: "RetailMediaOrder",
        entityId: created.id,
        details: { advertiserId: input.advertiserId, agencyId: input.agencyId, inventoryPackageId: input.inventoryPackageId, campaignId: input.campaignId, audioCreativeCount: input.creativePromoVersionIds.length, visualCreativeCount: input.visualAssetIds.length }
      } });
      return created;
    });
    return NextResponse.json({ order, reportingNotice: RETAIL_MEDIA_REPORTING_NOTICE }, { status: 201 });
  } catch (error) {
    console.error("Create retail-media order error:", error);
    return NextResponse.json({ error: error?.code === "P2002" ? "This campaign is already linked to a retail-media order." : "Unable to create the retail-media order." }, { status: error?.code === "P2002" ? 409 : 500 });
  }
}
