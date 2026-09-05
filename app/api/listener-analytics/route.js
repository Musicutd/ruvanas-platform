import { NextResponse } from "next/server";
import { accessDenied } from "@/lib/api-response";
import { requireListenerAnalyticsAccess } from "@/lib/listener-analytics-access";
import { loadListenerAnalyticsReport } from "@/lib/listener-analytics-service";
import { prisma } from "@/lib/prisma";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requireListenerAnalyticsAccess();
    if (!access.ok) return accessDenied(access);
    const search = request.nextUrl.searchParams;
    const report = await loadListenerAnalyticsReport(prisma, access.organisation.id, {
      days: search.get("days"),
      from: search.get("from"),
      to: search.get("to")
    });
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load listener analytics.";
    if (/Dates must|calendar date|report end|limited to/.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    securityLog("error", "LISTENER_ANALYTICS_REPORT_FAILED", request, { errorCode: error?.code || error?.name || "UNKNOWN" });
    return NextResponse.json({ error: "Unable to load listener analytics." }, { status: 500 });
  }
}
