import { prisma } from "@/lib/prisma";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { correctionsNetworkAuthority, setCorrectionsNetworkGrant } from "@/lib/corrections-network-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const { member } = await correctionsNetworkAuthority(prisma, access, "manage");
    if (member.role !== "OWNER") return correctionsResponse({ error: "Only the authority owner may review network grants." }, 403);
    const grants = await prisma.correctionsNetworkGrant.findMany({ where: { organisationId: access.organisationId },
      select: { id: true, organisationMemberId: true, canView: true, canManage: true, canPolicy: true, canProgramme: true, canDistribute: true, canReport: true, canAudit: true }, take: 100 });
    return correctionsResponse({ ok: true, grants });
  } catch (error) { return correctionsError(error); }
}

export async function PUT(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, grant: await setCorrectionsNetworkGrant(access, await request.json()) }); }
  catch (error) { return correctionsError(error); }
}
