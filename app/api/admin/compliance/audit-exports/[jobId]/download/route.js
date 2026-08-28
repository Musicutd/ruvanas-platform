import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/access-control";
import { getAuditExport } from "@/lib/compliance-service";
import { verifyAnalyticsExport } from "@/lib/operational-analytics.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can download audit exports." }, { status: 403 });
  const { jobId } = await params;
  const requestedOrganisationId = request.nextUrl.searchParams.get("organisationId");
  if (!requestedOrganisationId) return NextResponse.json({ error: "Organisation context is required." }, { status: 400 });
  const job = await getAuditExport(jobId, requestedOrganisationId, access.user.id);
  if (!job) return NextResponse.json({ error: "Audit export not found." }, { status: 404 });
  if (job.status !== "READY" || !job.csvContent) return NextResponse.json({ error: job.status === "EXPIRED" ? "This export has expired." : "This export is not ready." }, { status: 409 });
  const valid = verifyAnalyticsExport({ jobId: job.id, organisationId: job.organisationId, requestedByUserId: job.requestedByUserId, expiresAt: job.expiresAt }, request.nextUrl.searchParams.get("token"), process.env.SESSION_SECRET);
  if (!valid) return NextResponse.json({ error: "This export link is invalid or has expired." }, { status: 403 });
  return new NextResponse(job.csvContent, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="ruvanas-audit-${job.id}.csv"`,
    "cache-control": "private, no-store, max-age=0",
    "x-content-sha256": job.contentSha256 || "",
    "x-ruvanas-audit-seal": job.auditSeal?.sealHash || ""
  } });
}


