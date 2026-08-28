import { after, NextResponse } from "next/server";
import { requireOperationalAnalyticsAccess } from "@/lib/operational-analytics-access";
import { createOperationalAnalyticsExportJob, processOperationalAnalyticsExportJob } from "@/lib/operational-analytics-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const access = await requireOperationalAnalyticsAccess({ exportReport: true });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const job = await createOperationalAnalyticsExportJob({
      organisationId: access.organisation.id,
      requestedByUserId: access.user.id,
      filters: await request.json()
    });
    after(() => processOperationalAnalyticsExportJob(job.id));
    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        expiresAt: job.expiresAt.toISOString(),
        statusUrl: `/api/reports/operational/exports/${job.id}`
      }
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to queue the export." }, { status: 400 });
  }
}
