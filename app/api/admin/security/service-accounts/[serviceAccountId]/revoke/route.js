import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can revoke service accounts." }, { status: 403 });

    const serviceAccount = await prisma.serviceAccount.findUnique({ where: { id: String(params.serviceAccountId || "") } });
    if (!serviceAccount) return NextResponse.json({ error: "Service account not found." }, { status: 404 });
    const now = new Date();
    await prisma.$transaction([
      prisma.serviceAccount.update({ where: { id: serviceAccount.id }, data: { status: "REVOKED", revokedAt: now } }),
      prisma.apiKey.updateMany({ where: { serviceAccountId: serviceAccount.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } }),
      prisma.auditLog.create({ data: { organisationId: serviceAccount.organisationId, actorUserId: access.user.id, action: "SERVICE_ACCOUNT_REVOKED", entityType: "ServiceAccount", entityId: serviceAccount.id, details: { revokedAt: now, requestId: getRequestId(request) } } })
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Revoke service account error:", error);
    return NextResponse.json({ error: "Unable to revoke the service account." }, { status: 500 });
  }
}
