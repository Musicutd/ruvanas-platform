import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { loadCampaignProofReport } from "@/lib/campaign-proof-report-service";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";
import { RETAIL_MEDIA_REPORTING_NOTICE } from "@/lib/retail-media.mjs";

export const dynamic = "force-dynamic";
const MAX_ROWS = 2_000;

export async function GET(request, { params }) {
  try {
    const { orderId } = await params;
    const order = await prisma.retailMediaOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        organisationId: true,
        name: true,
        status: true,
        campaignId: true,
        advertiser: { select: { id: true, name: true } },
        agency: { select: { id: true, name: true } },
        inventoryPackage: { select: { id: true, name: true } }
      }
    });
    if (!order) return NextResponse.json({ error: "Retail-media order not found." }, { status: 404 });
    const access = await requireRetailMediaOrganisation(order.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    if (!order.campaignId) {
      return NextResponse.json({ error: "Link a campaign before requesting proof for this order." }, { status: 409 });
    }

    const search = new URL(request.url).searchParams;
    const report = await loadCampaignProofReport(order.organisationId, {
      from: search.get("from"),
      to: search.get("to"),
      campaignId: order.campaignId,
      locationId: search.get("locationId"),
      locationGroupId: search.get("locationGroupId")
    });
    return NextResponse.json({
      order: {
        id: order.id,
        name: order.name,
        status: order.status,
        advertiser: order.advertiser,
        agency: order.agency,
        inventoryPackage: order.inventoryPackage,
        campaignId: order.campaignId
      },
      report: {
        ...report,
        rows: report.rows.slice(0, MAX_ROWS),
        totalRows: report.rows.length,
        truncated: report.rows.length > MAX_ROWS
      },
      notice: RETAIL_MEDIA_REPORTING_NOTICE
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to build retail-media proof.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
