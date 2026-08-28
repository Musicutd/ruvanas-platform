import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { generateServiceApiKey } from "@/lib/enterprise-security.mjs";
import { getRequestId } from "@/lib/security-log";

const schema = z.object({ name: z.string().trim().min(2).max(100).default("Rotated key") });

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can rotate API keys." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid key name." }, { status: 400 });

    const serviceAccount = await prisma.serviceAccount.findUnique({ where: { id: String(params.serviceAccountId || "") } });
    if (!serviceAccount) return NextResponse.json({ error: "Service account not found." }, { status: 404 });
    if (serviceAccount.status !== "ACTIVE") return NextResponse.json({ error: "A revoked service account cannot receive new keys." }, { status: 409 });

    const material = generateServiceApiKey(process.env.SESSION_SECRET);
    const now = new Date();
    const key = await prisma.$transaction(async (tx) => {
      await tx.apiKey.updateMany({ where: { serviceAccountId: serviceAccount.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
      const created = await tx.apiKey.create({ data: { serviceAccountId: serviceAccount.id, name: parsed.data.name, prefix: material.prefix, tokenHash: material.tokenHash, expiresAt: serviceAccount.expiresAt } });
      await tx.auditLog.create({ data: { organisationId: serviceAccount.organisationId, actorUserId: access.user.id, action: "SERVICE_ACCOUNT_KEY_ROTATED", entityType: "ServiceAccount", entityId: serviceAccount.id, details: { keyId: created.id, keyPrefix: created.prefix, requestId: getRequestId(request) } } });
      return created;
    });

    return NextResponse.json({ ok: true, key: { id: key.id, name: key.name, prefix: key.prefix }, apiKey: material.rawKey, notice: "Copy this API key now. It cannot be shown again." });
  } catch (error) {
    console.error("Rotate service account key error:", error);
    return NextResponse.json({ error: "Unable to rotate the API key." }, { status: 500 });
  }
}
