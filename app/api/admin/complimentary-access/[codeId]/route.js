import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { clearComplimentaryAccess } from "@/lib/complimentary-access.mjs";

export async function PATCH(_request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can stop complimentary access." }, { status: 403 });
    }

    const accessCode = await prisma.complimentaryAccessCode.findUnique({
      where: { id: String(params.codeId || "") },
      include: { activeSubscription: { select: { id: true } }, plan: { select: { code: true } } }
    });
    if (!accessCode) return NextResponse.json({ error: "Complimentary access was not found." }, { status: 404 });
    if (accessCode.status === "REVOKED") return NextResponse.json({ ok: true, alreadyStopped: true });

    let revokedLeaseCount = 0;
    await prisma.$transaction(async (tx) => {
      if (accessCode.activeSubscription) {
        await tx.subscription.update({
          where: { id: accessCode.activeSubscription.id },
          data: clearComplimentaryAccess()
        });
        const leases = await tx.playerListenerLease.updateMany({
          where: { organisationId: accessCode.organisationId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        revokedLeaseCount = leases.count;
      }
      await tx.complimentaryAccessCode.update({
        where: { id: accessCode.id },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: access.user.id }
      });
      await tx.auditLog.create({
        data: {
          organisationId: accessCode.organisationId,
          actorUserId: access.user.id,
          action: "COMPLIMENTARY_ACCESS_REVOKED",
          entityType: "ComplimentaryAccessCode",
          entityId: accessCode.id,
          details: { planCode: accessCode.plan.code, codeSuffix: accessCode.codeSuffix, wasActive: Boolean(accessCode.activeSubscription), revokedLeaseCount }
        }
      });
    });

    return NextResponse.json({ ok: true, revokedLeaseCount });
  } catch (error) {
    console.error("Revoke complimentary access error:", error);
    return NextResponse.json({ error: "Unable to stop complimentary access." }, { status: 500 });
  }
}
