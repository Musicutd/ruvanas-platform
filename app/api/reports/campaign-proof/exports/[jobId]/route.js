import { after, NextResponse } from "next/server";
import { getCampaignProofExportJob, processCampaignProofExportJob } from "@/lib/campaign-proof-report-service";
import { requireActiveReportOrganisation } from "@/lib/report-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { jobId } = await params;
  const job = await getCampaignProofExportJob({
    jobId,
    organisationId: access.organisation.id,
    requestedByUserId: access.user.id
  });
  if (!job) return NextResponse.json({ error: "Report export not found." }, { status: 404 });
  if (job.status === "QUEUED" || (job.status === "PROCESSING" && job.leaseUntil && job.leaseUntil < new Date())) {
    after(() => processCampaignProofExportJob(job.id));
  }
  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      rowCount: job.rowCount,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() || null,
      expiresAt: job.expiresAt.toISOString(),
      error: job.status === "FAILED" ? job.errorMessage : null,
      downloadUrl: job.status === "READY" ? `/api/reports/campaign-proof/exports/${job.id}/download` : null
    }
  });
}

