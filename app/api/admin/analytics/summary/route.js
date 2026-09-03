import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { accessDenied } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/access-control";
import { adminManagementCsv, normaliseAdminAnalyticsRange } from "@/lib/admin-analytics.mjs";
import { getAdminAnalyticsSnapshot } from "@/lib/admin-analytics-service";
import { prisma } from "@/lib/prisma";
import { getRequestId, securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);

    const range = normaliseAdminAnalyticsRange(request.nextUrl.searchParams.get("range"));
    const snapshot = await getAdminAnalyticsSnapshot(prisma, { range, includeRestrictedOperations: access.user.role === "SUPER_ADMIN" });
    const csv = adminManagementCsv(snapshot);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.auditLog.create({
      data: {
        actorUserId: access.user.id,
        action: "ADMIN_MANAGEMENT_REPORT_DOWNLOADED",
        entityType: "Platform",
        entityId: "ruvanas",
        details: { range, from: snapshot.filters.from, to: snapshot.filters.to, contentSha256, requestId: getRequestId(request) }
      }
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ruvanas-management-${snapshot.filters.from}-${snapshot.filters.to}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-SHA256": contentSha256
      }
    });
  } catch (error) {
    securityLog("error", "ADMIN_MANAGEMENT_REPORT_FAILED", request, { errorCode: error?.code || error?.name || "UNKNOWN" });
    return NextResponse.json({ error: "Unable to prepare the management report." }, { status: 500 });
  }
}
