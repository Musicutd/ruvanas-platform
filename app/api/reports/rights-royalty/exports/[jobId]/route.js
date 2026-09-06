import { after, NextResponse } from "next/server";
import { requireActiveReportOrganisation } from "@/lib/report-access";
import { getRightsRoyaltyExportJob, processRightsRoyaltyExportJob } from "@/lib/rights-royalty-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { jobId } = await params;
  const job = await getRightsRoyaltyExportJob({ jobId, organisationId: access.organisation.id, requestedByUserId: access.user.id });
  if (!job) return NextResponse.json({ error: "Rights report not found." }, { status: 404 });
  if (job.status === "QUEUED" || (job.status === "PROCESSING" && job.leaseUntil && job.leaseUntil < new Date())) after(() => processRightsRoyaltyExportJob(job.id));
  return NextResponse.json({ job: { id: job.id, status: job.status, rowCount: job.rowCount, error: job.status === "FAILED" ? job.errorMessage : null, downloadUrl: job.status === "READY" && job.rightsAttestation ? `/api/reports/rights-royalty/exports/${job.id}/download` : null, attestedAt: job.rightsAttestation?.createdAt?.toISOString() || null } });
}
