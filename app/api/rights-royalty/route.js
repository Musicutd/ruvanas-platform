import { NextResponse } from "next/server";
import { requireActiveReportOrganisation } from "@/lib/report-access";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { loadRightsRoyaltyWorkspace, saveRightsAuthority, saveRightsWorkMapping } from "@/lib/rights-royalty-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const data = await loadRightsRoyaltyWorkspace(access.organisation.id);
  return NextResponse.json({ ...data, permissions: { canManage: ORGANISATION_MANAGER_ROLES.includes(access.membership.role) }, evidenceNotice: "Reports use append-only, device-confirmed completed music playback. They do not measure listeners or calculate a royalty amount." });
}

export async function POST(request) {
  const access = await requireActiveReportOrganisation();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!ORGANISATION_MANAGER_ROLES.includes(access.membership.role)) return NextResponse.json({ error: "Only an organisation owner or manager can change rights reporting setup." }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === "SAVE_AUTHORITY") {
      const authority = await saveRightsAuthority({ organisationId: access.organisation.id, actorUserId: access.user.id, authorityId: body.authorityId || null, input: body });
      return NextResponse.json({ ok: true, authority });
    }
    if (body.action === "SAVE_MAPPING") {
      const mapping = await saveRightsWorkMapping({ organisationId: access.organisation.id, actorUserId: access.user.id, authorityId: body.authorityId, trackId: body.trackId, input: body });
      return NextResponse.json({ ok: true, mapping });
    }
    return NextResponse.json({ error: "Choose a supported rights-reporting action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The rights-reporting change could not be saved." }, { status: 400 });
  }
}
