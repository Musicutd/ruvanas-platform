import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveReportOrganisation } from "@/lib/report-access";
import { loadCombinedDeliveryReport } from "@/lib/combined-delivery-report-service";
import { combinedDeliveryCsv } from "@/lib/combined-delivery-report.mjs";

export async function GET(request) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const params = request.nextUrl.searchParams;
    const report = await loadCombinedDeliveryReport(access.organisation.id, { from: params.get("from"), to: params.get("to"), retailMediaOrderId: params.get("retailMediaOrderId") }, 50_000);
    if (report.truncated) return NextResponse.json({ error: "Reduce the date range before exporting more than 100,000 delivery rows." }, { status: 413 });
    const csv = combinedDeliveryCsv(report.rows);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "COMBINED_DELIVERY_EXPORT_DOWNLOADED", entityType: "Organisation", entityId: access.organisation.id, details: { filters: report.filters, rowCount: report.rows.length, contentSha256 } } });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ruvanas-combined-delivery-${report.filters.from}-${report.filters.to}.csv"`, "Cache-Control": "private, no-store", "X-Content-SHA256": contentSha256 } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to export combined delivery evidence." }, { status: 400 });
  }
}
