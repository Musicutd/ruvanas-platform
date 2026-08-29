import { NextResponse } from "next/server";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { loadSchoolPublicationOperations } from "@/lib/school-publication-operations-service";
import { SCHOOL_PUBLICATION_EVIDENCE_NOTICE } from "@/lib/school-publication-operations.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const params = request.nextUrl.searchParams;
    const report = await loadSchoolPublicationOperations(access.organisation.id, { from: params.get("from"), to: params.get("to") });
    return NextResponse.json({ report, notice: SCHOOL_PUBLICATION_EVIDENCE_NOTICE }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "School publication operations could not be loaded." }, { status: 400 });
  }
}
