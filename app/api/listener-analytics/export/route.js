import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { accessDenied } from "@/lib/api-response";
import { requireListenerAnalyticsAccess } from "@/lib/listener-analytics-access";
import { listenerAnalyticsCsv } from "@/lib/listener-analytics.mjs";
import { loadListenerAnalyticsReport } from "@/lib/listener-analytics-service";
import { prisma } from "@/lib/prisma";
import { getRequestId, securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requireListenerAnalyticsAccess({ exportReport: true });
    if (!access.ok) return accessDenied(access);
    const search = request.nextUrl.searchParams;
    const report = await loadListenerAnalyticsReport(prisma, access.organisation.id, {
      days: search.get("days"),
      from: search.get("from"),
      to: search.get("to")
    });
    const csv = listenerAnalyticsCsv(report);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.auditLog.create({
      data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: "LISTENER_ANALYTICS_EXPORTED",
        entityType: "Organisation",
        entityId: access.organisation.id,
        details: { from: report.filters.from, to: report.filters.to, contentSha256, requestId: getRequestId(request) }
      }
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ruvanas-listener-analytics-${report.filters.from}-${report.filters.to}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-SHA256": contentSha256
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to export listener analytics.";
    if (/Dates must|calendar date|report end|limited to/.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    securityLog("error", "LISTENER_ANALYTICS_EXPORT_FAILED", request, { errorCode: error?.code || error?.name || "UNKNOWN" });
    return NextResponse.json({ error: "Unable to export listener analytics." }, { status: 500 });
  }
}
