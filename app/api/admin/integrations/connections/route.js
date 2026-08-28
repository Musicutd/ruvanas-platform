import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { encryptSecret } from "@/lib/crypto";
import { generateWebhookSecret } from "@/lib/outgoing-webhook-service";
import { normalizeWebhookEventTypes, validateWebhookEndpoint, WEBHOOK_EVENT_TYPES } from "@/lib/outgoing-webhooks.mjs";
import { getRequestId } from "@/lib/security-log";

const schema = z.object({
  organisationId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  endpointUrl: z.string().trim().max(2000),
  subscribedEventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1)
});

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can create integrations." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid integration." }, { status: 400 });
    const endpointUrl = validateWebhookEndpoint(parsed.data.endpointUrl);
    const events = normalizeWebhookEventTypes(parsed.data.subscribedEventTypes);
    const organisation = await prisma.organisation.findUnique({ where: { id: parsed.data.organisationId }, select: { id: true } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    const secret = generateWebhookSecret();
    const connection = await prisma.$transaction(async (tx) => {
      const item = await tx.integrationConnection.create({ data: { organisationId: organisation.id, createdByUserId: access.user.id, name: parsed.data.name, endpointUrl, encryptedSecret: encryptSecret(secret), subscribedEventTypes: events } });
      await tx.auditLog.create({ data: { organisationId: organisation.id, actorUserId: access.user.id, action: "INTEGRATION_CONNECTED", entityType: "IntegrationConnection", entityId: item.id, details: { endpointOrigin: new URL(endpointUrl).origin, events, requestId: getRequestId(request) } } });
      return item;
    });
    return NextResponse.json({ connection: { ...connection, encryptedSecret: undefined }, secret, notice: "Copy this signing secret now. Ruvanas stores it encrypted and will not display it again." }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That organisation already has an integration with this name." }, { status: 409 });
    const message = error instanceof Error ? error.message : "Unable to create the integration.";
    return NextResponse.json({ error: message }, { status: message.includes("Webhook") ? 400 : 500 });
  }
}

