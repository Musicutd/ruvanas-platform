import { NextResponse } from "next/server";
import { requireActiveReportOrganisation } from "@/lib/report-access";
import { loadCombinedDeliveryReport } from "@/lib/combined-delivery-report-service";
import { COMBINED_DELIVERY_NOTICE } from "@/lib/combined-delivery-report.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const params = request.nextUrl.searchParams;
    const report = await loadCombinedDeliveryReport(access.organisation.id, { from: params.get("from"), to: params.get("to"), retailMediaOrderId: params.get("retailMediaOrderId") });
    return NextResponse.json({ organisation: { id: access.organisation.id, name: access.organisation.name }, report, notice: COMBINED_DELIVERY_NOTICE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to build the combined delivery report." }, { status: 400 });
  }
}
