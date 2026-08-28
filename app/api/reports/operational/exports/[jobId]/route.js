import { NextResponse } from "next/server";
import { requireOperationalAnalyticsAccess } from "@/lib/operational-analytics-access";
import { getOperationalAnalyticsExportJob, operationalAnalyticsDownloadUrl, processOperationalAnalyticsExportJob } from "@/lib/operational-analytics-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const access = await requireOperationalAnalyticsAccess({ exportReport: true });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { jobId } = await params;
  let job = await getOperationalAnalyticsExportJob({ jobId, organisationId: access.organisation.id, requestedByUserId: access.user.id });
  if (!job) return NextResponse.json({ error: "Analytics export not found." }, { status: 404 });
  if (job.status === "QUEUED" || (job.status === "PROCESSING" && job.leaseUntil && job.leaseUntil < new Date())) {
    await processOperationalAnalyticsExportJob(job.id);
    job = await getOperationalAnalyticsExportJob({ jobId, organisationId: access.organisation.id, requestedByUserId: access.user.id });
  }
  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      rowCount: job.rowCount,
      error: job.errorMessage,
      expiresAt: job.expiresAt.toISOString(),
      downloadUrl: job.status === "READY" ? operationalAnalyticsDownloadUrl(job) : null
    }
  });
}
