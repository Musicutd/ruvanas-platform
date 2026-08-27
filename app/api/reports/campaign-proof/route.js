import { NextResponse } from "next/server";
import { loadCampaignProofDimensions, loadCampaignProofReport } from "@/lib/campaign-proof-report-service";
import { requireActiveReportOrganisation } from "@/lib/report-access";

export const dynamic = "force-dynamic";
const MAX_DASHBOARD_ROWS = 2_000;

function filtersFromUrl(request) {
  const params = request.nextUrl.searchParams;
  return {
    from: params.get("from"),
    to: params.get("to"),
    campaignId: params.get("campaignId"),
    promoVersionId: params.get("promoVersionId"),
    locationId: params.get("locationId"),
    locationGroupId: params.get("locationGroupId")
  };
}

export async function GET(request) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const [report, dimensions] = await Promise.all([
      loadCampaignProofReport(access.organisation.id, filtersFromUrl(request)),
      loadCampaignProofDimensions(access.organisation.id)
    ]);
    const dashboardReport = {
      ...report,
      rows: report.rows.slice(0, MAX_DASHBOARD_ROWS),
      totalRows: report.rows.length,
      truncated: report.rows.length > MAX_DASHBOARD_ROWS
    };
    return NextResponse.json({
      organisation: { id: access.organisation.id, name: access.organisation.name },
      report: dashboardReport,
      dimensions,
      notice: "Playback figures are device-confirmed events. They do not measure listeners, audience, or reach."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to build the report.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

