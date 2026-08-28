import { NextResponse } from "next/server";
import { requireOperationalAnalyticsAccess } from "@/lib/operational-analytics-access";
import { loadOperationalAnalyticsReport, refreshOperationalAnalytics } from "@/lib/operational-analytics-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function filtersFromUrl(request) {
  return { from: request.nextUrl.searchParams.get("from"), to: request.nextUrl.searchParams.get("to") };
}

export async function GET(request) {
  const access = await requireOperationalAnalyticsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const aggregation = await refreshOperationalAnalytics(access.organisation.id);
    const report = await loadOperationalAnalyticsReport(access.organisation.id, filtersFromUrl(request), aggregation);
    return NextResponse.json({
      organisation: { id: access.organisation.id, name: access.organisation.name },
      canExport: access.canExport,
      report
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load operational analytics." }, { status: 400 });
  }
}
