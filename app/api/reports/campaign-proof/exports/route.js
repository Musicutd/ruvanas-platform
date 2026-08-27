import { after, NextResponse } from "next/server";
import { createCampaignProofExportJob, processCampaignProofExportJob } from "@/lib/campaign-proof-report-service";
import { requireActiveReportOrganisation } from "@/lib/report-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const job = await createCampaignProofExportJob({
      organisationId: access.organisation.id,
      requestedByUserId: access.user.id,
      filters: await request.json()
    });
    after(() => processCampaignProofExportJob(job.id));
    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        expiresAt: job.expiresAt.toISOString(),
        statusUrl: `/api/reports/campaign-proof/exports/${job.id}`
      }
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue the export.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

