import { NextResponse } from "next/server";
import { requireOperationalAnalyticsAccess } from "@/lib/operational-analytics-access";
import { getOperationalAnalyticsExportJob } from "@/lib/operational-analytics-service";
import { verifyAnalyticsExport } from "@/lib/operational-analytics.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const access = await requireOperationalAnalyticsAccess({ exportReport: true });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { jobId } = await params;
  const job = await getOperationalAnalyticsExportJob({ jobId, organisationId: access.organisation.id, requestedByUserId: access.user.id });
  if (!job) return NextResponse.json({ error: "Analytics export not found." }, { status: 404 });
  if (job.status !== "READY" || !job.csvContent) {
    return NextResponse.json({ error: job.status === "EXPIRED" ? "This export has expired." : "This export is not ready." }, { status: 409 });
  }
  const valid = verifyAnalyticsExport({
    jobId: job.id,
    organisationId: job.organisationId,
    requestedByUserId: job.requestedByUserId,
    expiresAt: job.expiresAt
  }, request.nextUrl.searchParams.get("token"), process.env.SESSION_SECRET);
  if (!valid) return NextResponse.json({ error: "This export link is invalid or has expired." }, { status: 403 });
  return new NextResponse(job.csvContent, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ruvanas-operational-analytics-${job.id}.csv"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-sha256": job.contentSha256 || ""
    }
  });
}
