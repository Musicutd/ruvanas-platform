import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ORGANISATION_CONTENT_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  campaignTargetCreateData,
  normaliseCampaignPayload
} from "@/lib/campaign-scheduling.mjs";
import { prepareCampaignPreview } from "@/lib/campaign-service";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function serializeCampaign(campaign) {
  return {
    id: campaign.id,
    organisationId: campaign.organisationId,
    name: campaign.name,
    status: campaign.status,
    priority: campaign.priority,
    schedulingMode: campaign.schedulingMode,
    mandatory: campaign.mandatory,
    respectOpeningHours: campaign.respectOpeningHours,
    effectiveFrom: campaign.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: campaign.effectiveTo.toISOString().slice(0, 10),
    publicationRevision: campaign.publicationRevision,
    publishedAt: campaign.publishedAt?.toISOString() || null,
    organisation: campaign.organisation,
    promoVersion: {
      id: campaign.promoVersion.id,
      version: campaign.promoVersion.version,
      promoAsset: campaign.promoVersion.promoAsset
    },
    targets: campaign.targets,
    rule: campaign.rule,
    schedules: campaign.schedules
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });

    let organisationIds = null;
    if (user.role !== "SUPER_ADMIN") {
      const memberships = await prisma.organisationMember.findMany({
        where: { userId: user.id },
        select: { organisationId: true }
      });
      organisationIds = memberships.map((membership) => membership.organisationId);
    }

    const campaigns = await prisma.campaign.findMany({
      where: {
        status: { not: "ARCHIVED" },
        ...(organisationIds ? { organisationId: { in: organisationIds } } : {})
      },
      include: {
        organisation: { select: { id: true, name: true } },
        promoVersion: {
          select: {
            id: true,
            version: true,
            promoAsset: { select: { id: true, name: true, mediaType: true } }
          }
        },
        targets: true,
        rule: true,
        schedules: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }, { exactMinute: "asc" }] }
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });
    return NextResponse.json({ campaigns: campaigns.map(serializeCampaign) });
  } catch (error) {
    console.error("List campaigns error:", error);
    return NextResponse.json({ error: "Unable to load campaigns." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    let campaign;
    try {
      campaign = normaliseCampaignPayload(await request.json());
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const access = await requireOrganisationAccess(campaign.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    if (campaign.mandatory && access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can create a mandatory corporate campaign." }, { status: 403 });
    }

    const prepared = await prepareCampaignPreview(campaign);
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.campaign.create({
        data: {
          organisationId: campaign.organisationId,
          promoVersionId: campaign.promoVersionId,
          name: campaign.name,
          status: "DRAFT",
          priority: campaign.priority,
          schedulingMode: campaign.schedulingMode,
          mandatory: campaign.mandatory,
          respectOpeningHours: campaign.respectOpeningHours,
          effectiveFrom: new Date(`${campaign.effectiveFrom}T00:00:00.000Z`),
          effectiveTo: new Date(`${campaign.effectiveTo}T00:00:00.000Z`),
          maxPromoMinutesPerHour: campaign.maxPromoMinutesPerHour,
          minSamePromoGapMinutes: campaign.minSamePromoGapMinutes,
          minAnyPromoGapMinutes: campaign.minAnyPromoGapMinutes,
          targets: { create: campaign.targets.map(campaignTargetCreateData) },
          rule: { create: {
            playsPerHour: campaign.playsPerHour,
            intervalMinutes: campaign.intervalMinutes,
            exactTimeHardStart: campaign.exactTimeHardStart
          } },
          schedules: { create: campaign.schedules }
        },
        include: { targets: true, rule: true, schedules: true }
      });
      await tx.auditLog.create({ data: {
        organisationId: campaign.organisationId,
        actorUserId: access.user.id,
        action: "CAMPAIGN_DRAFT_CREATED",
        entityType: "Campaign",
        entityId: record.id,
        details: {
          promoVersionId: campaign.promoVersionId,
          targetZoneCount: prepared.preview.targetZoneCount,
          estimatedTotalPlays: prepared.preview.estimatedTotalPlays,
          schedulingMode: campaign.schedulingMode,
          mandatory: campaign.mandatory
        }
      } });
      return record;
    });

    return NextResponse.json({ ok: true, campaign: created, preview: prepared.preview }, { status: 201 });
  } catch (error) {
    console.error("Create campaign error:", error);
    return NextResponse.json({ error: error.message || "Unable to create the campaign draft." }, { status: 400 });
  }
}
