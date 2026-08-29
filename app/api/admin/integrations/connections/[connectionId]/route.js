import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { encryptSecret } from "@/lib/crypto";
import { generateWebhookSecret } from "@/lib/outgoing-webhook-service";

const schema = z.object({ action: z.enum(["disconnect", "reconnect", "revoke", "rotate_secret"]) });

export async function PATCH(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can manage integrations." }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid integration action." }, { status: 400 });
  const { connectionId } = await params;
  const existing = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!existing) return NextResponse.json({ error: "Integration not found." }, { status: 404 });
  if (existing.status === "REVOKED" && parsed.data.action !== "revoke") return NextResponse.json({ error: "A revoked integration cannot be reactivated." }, { status: 409 });
  if (parsed.data.action === "rotate_secret" && existing.kind !== "OUTGOING_WEBHOOK") {
    return NextResponse.json({ error: "Metric integrations use service-account keys, which are rotated from Enterprise security." }, { status: 409 });
  }
  const now = new Date();
  const secret = parsed.data.action === "rotate_secret" ? generateWebhookSecret() : null;
  const data = parsed.data.action === "disconnect" ? { status: "DISCONNECTED", disconnectedAt: now }
    : parsed.data.action === "reconnect" ? { status: "CONNECTED", disconnectedAt: null, lastErrorAt: null, lastErrorMessage: null }
    : parsed.data.action === "revoke" ? { status: "REVOKED", revokedAt: now, disconnectedAt: now }
    : { encryptedSecret: encryptSecret(secret), status: "CONNECTED", revokedAt: null, disconnectedAt: null, lastErrorAt: null, lastErrorMessage: null };
  const connection = await prisma.$transaction(async (tx) => {
    const item = await tx.integrationConnection.update({ where: { id: existing.id }, data });
    await tx.auditLog.create({ data: { organisationId: existing.organisationId, actorUserId: access.user.id, action: `INTEGRATION_${parsed.data.action.toUpperCase()}`, entityType: "IntegrationConnection", entityId: existing.id } });
    return item;
  });
  return NextResponse.json({ connection: { ...connection, encryptedSecret: undefined }, ...(secret ? { secret, notice: "Copy this new signing secret now." } : {}) });
}

