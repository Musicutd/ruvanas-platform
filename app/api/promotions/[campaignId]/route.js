import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canPublishSubscriberPromotions } from "@/lib/subscriber-promotions.mjs";
import { PATCH as publishCampaign } from "@/app/api/admin/campaigns/[campaignId]/publish/route";
import { PATCH as changeCampaignStatus } from "@/app/api/admin/campaigns/[campaignId]/status/route";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
      return NextResponse.json({ error: "Promotions are unavailable while this radio service is inactive." }, { status: 403 });
    }
    if (!canPublishSubscriberPromotions(context.membership.role)) {
      return NextResponse.json({ error: "Only organisation owners and managers can publish or stop promotions." }, { status: 403 });
    }
    const { campaignId } = await params;
    const record = await prisma.campaign.findFirst({
      where: { id: campaignId, organisationId: context.membership.organisationId },
      select: { id: true, mandatory: true, retailMediaOrder: { select: { id: true } } }
    });
    if (!record) return NextResponse.json({ error: "Promotion not found." }, { status: 404 });
    if (record.mandatory || record.retailMediaOrder) {
      return NextResponse.json({ error: "This protected campaign is managed through Ruvanas operations." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toUpperCase();
    const routeContext = { params: Promise.resolve({ campaignId }) };
    if (action === "PUBLISH") {
      if (body.previewAcknowledged !== true) {
        return NextResponse.json({ error: "Review the saved promotion summary before publishing." }, { status: 400 });
      }
      return publishCampaign(request, routeContext);
    }
    if (!["PAUSE", "ARCHIVE"].includes(action)) {
      return NextResponse.json({ error: "Choose publish, pause or archive." }, { status: 400 });
    }
    const delegatedRequest = new Request(request.url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: request.headers.get("cookie") || "" },
      body: JSON.stringify({ status: action === "PAUSE" ? "PAUSED" : "ARCHIVED" })
    });
    return changeCampaignStatus(delegatedRequest, routeContext);
  } catch (error) {
    console.error("Subscriber promotion action error:", error);
    return NextResponse.json({ error: "Unable to update this promotion." }, { status: 500 });
  }
}
