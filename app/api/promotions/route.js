import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { normaliseCampaignPayload, campaignTargetCreateData } from "@/lib/campaign-scheduling.mjs";
import { loadCampaignTopology, prepareCampaignPreview } from "@/lib/campaign-service";
import {
  canDraftSubscriberPromotions,
  canPublishSubscriberPromotions,
  describePromotionTarget,
  requirePromotionPreview,
  subscriberPromotionInput
} from "@/lib/subscriber-promotions.mjs";

export const dynamic = "force-dynamic";

async function activeContext() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context || !context.membership) return { error: "No active organisation is available.", status: context ? 403 : 401 };
  if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
    return { error: "Promotions are unavailable while this radio service is inactive.", status: 403 };
  }
  return { context };
}

function serialiseCampaign(campaign, lookup) {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    priority: campaign.priority,
    schedulingMode: campaign.schedulingMode,
    effectiveFrom: campaign.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: campaign.effectiveTo.toISOString().slice(0, 10),
    publishedAt: campaign.publishedAt?.toISOString() || null,
    mandatory: campaign.mandatory,
    protected: campaign.mandatory || Boolean(campaign.retailMediaOrder),
    promo: {
      name: campaign.promoVersion.promoAsset.name,
      version: campaign.promoVersion.version,
      durationSeconds: campaign.promoVersion.durationSeconds
    },
    targets: campaign.targets.map((target) => ({
      type: target.targetType,
      label: describePromotionTarget(target, lookup)
    })),
    schedules: campaign.schedules.map((schedule) => ({
      weekday: schedule.weekday,
      windowMode: schedule.windowMode,
      startMinute: schedule.startMinute,
      endMinute: schedule.endMinute,
      playsPerHour: schedule.playsPerHour,
      intervalMinutes: schedule.intervalMinutes
    }))
  };
}

export async function GET() {
  try {
    const result = await activeContext();
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    const { context } = result;
    const organisationId = context.membership.organisationId;
    const [topology, promos, campaigns] = await Promise.all([
      loadCampaignTopology(organisationId),
      prisma.promoVersion.findMany({
        where: {
          status: "APPROVED",
          promoAsset: { organisationId, status: "ACTIVE" },
          mediaAsset: { status: "READY" }
        },
        select: {
          id: true,
          version: true,
          languageCode: true,
          durationSeconds: true,
          promoAsset: { select: { id: true, name: true, mediaType: true } }
        },
        orderBy: [{ promoAsset: { name: "asc" } }, { version: "desc" }]
      }),
      prisma.campaign.findMany({
        where: { organisationId, status: { not: "ARCHIVED" } },
        include: {
          promoVersion: { select: { version: true, durationSeconds: true, promoAsset: { select: { name: true } } } },
          targets: true,
          schedules: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
          retailMediaOrder: { select: { id: true } }
        },
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: 100
      })
    ]);
    const lookup = Object.fromEntries([
      ...topology.brands.map((item) => [item.id, item.name]),
      ...topology.groups.map((item) => [item.id, item.name]),
      ...topology.locations.map((item) => [item.id, item.name]),
      ...topology.zones.map((zone) => {
        const location = topology.locations.find((item) => item.id === zone.locationId);
        return [zone.id, `${location?.name || "Location"} / ${zone.name}`];
      })
    ]);
    return NextResponse.json({
      ok: true,
      canDraft: canDraftSubscriberPromotions(context.membership.role),
      canPublish: canPublishSubscriberPromotions(context.membership.role),
      promos: promos.map((promo) => ({
        id: promo.id,
        name: promo.promoAsset.name,
        version: promo.version,
        languageCode: promo.languageCode,
        durationSeconds: promo.durationSeconds
      })),
      targets: [
        { type: "ALL_LOCATIONS", id: "all", label: "All active locations" },
        ...topology.locations.map((item) => ({ type: "LOCATION", id: item.id, label: item.name })),
        ...topology.zones.map((zone) => ({ type: "ZONE", id: zone.id, label: lookup[zone.id] }))
      ],
      campaigns: campaigns.map((campaign) => serialiseCampaign(campaign, lookup))
    });
  } catch (error) {
    console.error("Subscriber promotions load error:", error);
    return NextResponse.json({ error: "Unable to load promotions." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const result = await activeContext();
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    const { context } = result;
    if (!canDraftSubscriberPromotions(context.membership.role)) {
      return NextResponse.json({ error: "Your organisation role has read-only access to promotions." }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Add promotion details before continuing." }, { status: 400 });
    const organisationId = context.membership.organisationId;
    let campaign;
    try {
      campaign = normaliseCampaignPayload(subscriberPromotionInput(body, organisationId));
      if (body.previewOnly !== true) requirePromotionPreview(body);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const prepared = await prepareCampaignPreview(campaign);
    if (body.previewOnly === true) {
      return NextResponse.json({
        ok: true,
        preview: prepared.preview,
        promo: { name: prepared.promoVersion.promoAsset.name, version: prepared.promoVersion.version },
        targetZones: prepared.targetZones
      });
    }
    if (!prepared.preview.canPublish) {
      return NextResponse.json({ error: "Resolve the preview issues before saving this promotion.", preview: prepared.preview }, { status: 409 });
    }
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.campaign.create({
        data: {
          organisationId,
          promoVersionId: campaign.promoVersionId,
          name: campaign.name,
          status: "DRAFT",
          priority: campaign.priority,
          schedulingMode: campaign.schedulingMode,
          mandatory: false,
          respectOpeningHours: campaign.respectOpeningHours,
          effectiveFrom: new Date(`${campaign.effectiveFrom}T00:00:00.000Z`),
          effectiveTo: new Date(`${campaign.effectiveTo}T00:00:00.000Z`),
          maxPromoMinutesPerHour: campaign.maxPromoMinutesPerHour,
          minSamePromoGapMinutes: campaign.minSamePromoGapMinutes,
          minAnyPromoGapMinutes: campaign.minAnyPromoGapMinutes,
          targets: { create: campaign.targets.map(campaignTargetCreateData) },
          rule: { create: { playsPerHour: campaign.playsPerHour, intervalMinutes: campaign.intervalMinutes, exactTimeHardStart: false } },
          schedules: { create: campaign.schedules }
        }
      });
      await tx.auditLog.create({ data: {
        organisationId,
        actorUserId: context.user.id,
        action: "SUBSCRIBER_PROMOTION_DRAFT_CREATED",
        entityType: "Campaign",
        entityId: record.id,
        details: {
          promoVersionId: campaign.promoVersionId,
          targetZoneCount: prepared.preview.targetZoneCount,
          estimatedTotalPlays: prepared.preview.estimatedTotalPlays,
          previewAcknowledged: true,
          subscriberWorkspace: true
        }
      } });
      return record;
    });
    return NextResponse.json({ ok: true, campaign: created, preview: prepared.preview }, { status: 201 });
  } catch (error) {
    console.error("Subscriber promotion save error:", error);
    return NextResponse.json({ error: error.message || "Unable to save this promotion." }, { status: 400 });
  }
}
