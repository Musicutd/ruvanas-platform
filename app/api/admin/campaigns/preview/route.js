import { NextResponse } from "next/server";
import {
  ORGANISATION_CONTENT_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { normaliseCampaignPayload } from "@/lib/campaign-scheduling.mjs";
import { prepareCampaignPreview } from "@/lib/campaign-service";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can preview a mandatory corporate campaign." }, { status: 403 });
    }
    const prepared = await prepareCampaignPreview(campaign);
    return NextResponse.json({
      preview: prepared.preview,
      promo: {
        name: prepared.promoVersion.promoAsset.name,
        version: prepared.promoVersion.version
      },
      targetZones: prepared.targetZones
    });
  } catch (error) {
    console.error("Preview campaign error:", error);
    return NextResponse.json({ error: error.message || "Unable to preview the campaign." }, { status: 400 });
  }
}
