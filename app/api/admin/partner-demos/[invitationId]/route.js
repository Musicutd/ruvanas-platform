import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { securityLog } from "@/lib/security-log";

export async function PATCH(request, { params }) {
  const { invitationId } = await params;
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Super Admin access is required." }, { status: 403 });
  }

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.partnerDemoInvitation.updateMany({
        where: { id: invitationId, revokedAt: null },
        data: { revokedAt: now, codeHash: null, sessionHash: null }
      });
      if (changed.count) {
        await tx.auditLog.create({ data: {
          actorUserId: user.id,
          action: "PARTNER_DEMO_REVOKED",
          entityType: "PartnerDemoInvitation",
          entityId: invitationId
        } });
      }
      return changed.count;
    });
    if (!result) return NextResponse.json({ error: "Invitation is unavailable or already revoked." }, { status: 404 });
    securityLog("info", "PARTNER_DEMO_REVOKED", request, { invitationId, actorUserId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    securityLog("error", "PARTNER_DEMO_REVOKE_ERROR", request, { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Unable to revoke partner access." }, { status: 500 });
  }
}
