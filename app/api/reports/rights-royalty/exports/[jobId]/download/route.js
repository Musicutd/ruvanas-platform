import { NextResponse } from "next/server";
import { requireActiveReportOrganisation } from "@/lib/report-access";
import { getRightsRoyaltyExportJob } from "@/lib/rights-royalty-service";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { jobId } = await params;
  const job = await getRightsRoyaltyExportJob({ jobId, organisationId: access.organisation.id, requestedByUserId: access.user.id });
  if (!job) return NextResponse.json({ error: "Rights report not found." }, { status: 404 });
  if (job.status !== "READY" || !job.csvContent || !job.rightsAttestation) return NextResponse.json({ error: "This attested rights report is not ready." }, { status: 409 });
  return new Response(job.csvContent, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ruvanas-rights-usage-${job.id}.csv"`, "cache-control": "private, no-store", "x-content-sha256": job.contentSha256 || "" } });
}
