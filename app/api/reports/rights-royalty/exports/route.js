import { after, NextResponse } from "next/server";
import { requireActiveReportOrganisation } from "@/lib/report-access";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { createRightsRoyaltyExportJob, processRightsRoyaltyExportJob } from "@/lib/rights-royalty-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!ORGANISATION_MANAGER_ROLES.includes(access.membership.role)) {
    return NextResponse.json({ error: "Only an organisation owner or manager can attest and generate a rights report." }, { status: 403 });
  }
  try {
    const job = await createRightsRoyaltyExportJob({ organisationId: access.organisation.id, requestedByUserId: access.user.id, filters: await request.json() });
    after(() => processRightsRoyaltyExportJob(job.id));
    return NextResponse.json({ job: { id: job.id, status: job.status, statusUrl: `/api/reports/rights-royalty/exports/${job.id}`, expiresAt: job.expiresAt.toISOString() } }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to queue the rights report." }, { status: 400 });
  }
}
