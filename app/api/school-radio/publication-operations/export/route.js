import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { loadSchoolPublicationOperations } from "@/lib/school-publication-operations-service";
import { schoolPublicationEvidenceCsv } from "@/lib/school-publication-operations.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const params = request.nextUrl.searchParams;
    const report = await loadSchoolPublicationOperations(access.organisation.id, { from: params.get("from"), to: params.get("to") });
    const csv = schoolPublicationEvidenceCsv(report);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.auditLog.create({ data: {
      organisationId: access.organisation.id,
      actorUserId: access.user.id,
      action: "SCHOOL_PUBLICATION_EVIDENCE_EXPORTED",
      entityType: "Organisation",
      entityId: access.organisation.id,
      details: { filters: report.filters, episodeCount: report.episodes.length, contentSha256, privacyBasis: "aggregate-origin-delivery-evidence" }
    } });
    return new NextResponse(csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ruvanas-school-publication-evidence-${report.filters.from}-${report.filters.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-SHA256": contentSha256
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "School publication evidence could not be exported." }, { status: 400 });
  }
}
