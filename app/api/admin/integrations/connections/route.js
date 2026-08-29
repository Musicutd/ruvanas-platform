import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { encryptSecret } from "@/lib/crypto";
import { generateWebhookSecret } from "@/lib/outgoing-webhook-service";
import { normalizeWebhookEventTypes, validateWebhookEndpoint, WEBHOOK_EVENT_TYPES } from "@/lib/outgoing-webhooks.mjs";
import { METRIC_CONNECTION_KINDS } from "@/lib/integration-metrics.mjs";
import { getRequestId } from "@/lib/security-log";

const schema = z.object({
  organisationId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  kind: z.enum(["OUTGOING_WEBHOOK", ...METRIC_CONNECTION_KINDS]).default("OUTGOING_WEBHOOK"),
  endpointUrl: z.string().trim().max(2000).optional().nullable(),
  subscribedEventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).optional().default([]),
  providerKey: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/).optional().nullable()
});

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can create integrations." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid integration." }, { status: 400 });
    const isWebhook = parsed.data.kind === "OUTGOING_WEBHOOK";
    let endpointUrl = null;
    let events = [];
    if (isWebhook) {
      if (!parsed.data.endpointUrl) return NextResponse.json({ error: "Enter the trusted HTTPS webhook endpoint." }, { status: 400 });
      endpointUrl = validateWebhookEndpoint(parsed.data.endpointUrl);
      events = normalizeWebhookEventTypes(parsed.data.subscribedEventTypes);
      if (!events.length) return NextResponse.json({ error: "Choose at least one webhook event." }, { status: 400 });
    } else if (!parsed.data.providerKey) {
      return NextResponse.json({ error: "Enter a provider key for the summarized metric connection." }, { status: 400 });
    }
    const organisation = await prisma.organisation.findUnique({ where: { id: parsed.data.organisationId }, select: { id: true } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    const secret = isWebhook ? generateWebhookSecret() : null;
    const connection = await prisma.$transaction(async (tx) => {
      const item = await tx.integrationConnection.create({
        data: {
          organisationId: organisation.id,
          createdByUserId: access.user.id,
          name: parsed.data.name,
          kind: parsed.data.kind,
          providerKey: isWebhook ? "GENERIC_WEBHOOK_V1" : parsed.data.providerKey.toUpperCase(),
          endpointUrl,
          encryptedSecret: secret ? encryptSecret(secret) : null,
          subscribedEventTypes: events,
          configuration: isWebhook ? null : { formatVersion: 1, acceptsSummariesOnly: true }
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: access.user.id,
          action: "INTEGRATION_CONNECTED",
          entityType: "IntegrationConnection",
          entityId: item.id,
          details: {
            kind: item.kind,
            providerKey: item.providerKey,
            ...(endpointUrl ? { endpointOrigin: new URL(endpointUrl).origin, events } : { acceptsSummariesOnly: true }),
            requestId: getRequestId(request)
          }
        }
      });
      return item;
    });
    return NextResponse.json({
      connection: { ...connection, encryptedSecret: undefined },
      ...(secret ? {
        secret,
        notice: "Copy this signing secret now. Ruvanas stores it encrypted and will not display it again."
      } : {
        notice: "Metric connection created. Use a service account with metrics:write and send only location-level summaries."
      })
    }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That organisation already has an integration with this name." }, { status: 409 });
    const message = error instanceof Error ? error.message : "Unable to create the integration.";
    return NextResponse.json({ error: message }, { status: message.includes("Webhook") ? 400 : 500 });
  }
}

