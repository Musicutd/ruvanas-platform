import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ORGANISATION_MANAGER_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { campaignConfigurationHash } from "@/lib/campaign-scheduling.mjs";
import {
  persistedCampaignToInput,
  prepareCampaignPreview
} from "@/lib/campaign-service";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(_request, { params }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    const { campaignId } = await params;
    const record = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { targets: true, rule: true, schedules: true }
    });
    if (!record) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

    const access = await requireOrganisationAccess(record.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    if (record.mandatory && access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can publish a mandatory corporate campaign." }, { status: 403 });
    }
    if (record.status !== "DRAFT") {
      return NextResponse.json({ error: "Only a campaign draft can be published." }, { status: 409 });
    }

    const campaign = persistedCampaignToInput(record);
    const prepared = await prepareCampaignPreview(campaign, { excludeCampaignId: record.id });
    if (!prepared.preview.canPublish) {
      return NextResponse.json({ error: "Campaign guardrails must pass before publication.", preview: prepared.preview }, { status: 409 });
    }
    const configurationHash = campaignConfigurationHash({
      ...campaign,
      targetZoneIds: prepared.targetZones.map((zone) => zone.id)
    });

    const published = await prisma.$transaction(async (tx) => {
      const updated = await tx.campaign.updateMany({
        where: { id: record.id, status: "DRAFT", publicationRevision: record.publicationRevision },
        data: {
          status: "PUBLISHED",
          publicationRevision: { increment: 1 },
          publishedConfigurationHash: configurationHash,
          publishedById: access.user.id,
          publishedAt: new Date()
        }
      });
      if (updated.count !== 1) throw new Error("The campaign changed while it was being published. Review the latest draft and retry.");
      await tx.auditLog.create({ data: {
        organisationId: record.organisationId,
        actorUserId: access.user.id,
        action: "CAMPAIGN_PUBLISHED",
        entityType: "Campaign",
        entityId: record.id,
        details: {
          publicationRevision: record.publicationRevision + 1,
          configurationHash,
          promoVersionId: record.promoVersionId,
          targetZoneCount: prepared.preview.targetZoneCount,
          estimatedTotalPlays: prepared.preview.estimatedTotalPlays,
          warnings: prepared.preview.warnings
        }
      } });
      return tx.campaign.findUnique({ where: { id: record.id } });
    });
    return NextResponse.json({ ok: true, campaign: published, preview: prepared.preview });
  } catch (error) {
    console.error("Publish campaign error:", error);
    return NextResponse.json({ error: error.message || "Unable to publish the campaign." }, { status: 409 });
  }
}
