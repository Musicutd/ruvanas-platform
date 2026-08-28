import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can revoke organisation sessions." }, { status: 403 });
    }

    const organisationId = String(params.organisationId || "");
    const organisation = await prisma.organisation.findUnique({ where: { id: organisationId } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });

    const revokedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const sessions = await tx.session.updateMany({
        where: { activeOrganisationId: organisationId, revokedAt: null },
        data: { revokedAt }
      });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: access.user.id,
          action: "ORGANISATION_SESSIONS_REVOKED",
          entityType: "Organisation",
          entityId: organisationId,
          details: { revokedSessionCount: sessions.count, revokedAt, requestId: getRequestId(request) }
        }
      });
      return sessions;
    });

    return NextResponse.json({ ok: true, revokedSessionCount: result.count });
  } catch (error) {
    console.error("Revoke organisation sessions error:", error);
    return NextResponse.json({ error: "Unable to revoke organisation sessions." }, { status: 500 });
  }
}
