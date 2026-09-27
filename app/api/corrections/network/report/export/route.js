import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { loadCorrectionsNetworkReport } from "@/lib/corrections-network-report-service";
import { correctionsNetworkReportCsv } from "@/lib/corrections-network-report.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const report = await loadCorrectionsNetworkReport(access, Object.fromEntries(new URL(request.url).searchParams));
    const csv = correctionsNetworkReportCsv(report.rows);
    const checksum = createHash("sha256").update(csv).digest("hex");
    await prisma.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_NETWORK_REPORT_EXPORTED", entityType: "Organisation", entityId: access.organisationId,
      details: { from: report.filters.from, to: report.filters.to, facilityId: report.filters.facilityId,
        groupId: report.filters.groupId, source: report.filters.source, status: report.filters.status,
        classification: report.filters.classification, kind: report.filters.kind,
        programmeId: report.filters.programmeId, rehabilitationId: report.filters.rehabilitationId,
        announcementId: report.filters.announcementId,
        rowCount: report.rows.length, contentSha256: checksum } } });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ruvanas-inside-network-${report.filters.from}-${report.filters.to}.csv"`,
      "Cache-Control": "private, no-store", "X-Content-SHA256": checksum } });
  } catch (error) { return correctionsError(error); }
}
