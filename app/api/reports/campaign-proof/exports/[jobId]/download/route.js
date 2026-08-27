import { NextResponse } from "next/server";
import { getCampaignProofExportJob } from "@/lib/campaign-proof-report-service";
import { requireActiveReportOrganisation } from "@/lib/report-access";

export const dynamic = "force-dynamic";

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
  if (job.status !== "READY" || !job.csvContent) {
    return NextResponse.json({ error: job.status === "EXPIRED" ? "This export has expired." : "This export is not ready." }, { status: 409 });
  }
  return new Response(job.csvContent, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ruvanas-campaign-proof-${job.id}.csv"`,
      "cache-control": "private, no-store",
      "x-content-sha256": job.contentSha256 || ""
    }
  });
}

