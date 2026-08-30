import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { processOutgoingWebhookBatch, recoverAbandonedWebhookEvents } from "@/lib/outgoing-webhook-service";
import { z } from "zod";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("DELIVER_DUE") }),
  z.object({ action: z.literal("RECOVER_ABANDONED"), note: z.string().trim().min(8).max(500) })
]);

async function connectionDeliveryState(connectionId) {
  const [groups, events] = await Promise.all([
    prisma.outgoingWebhookEvent.groupBy({ by: ["status"], where: { connectionId }, _count: { _all: true } }),
    prisma.outgoingWebhookEvent.findMany({
      where: { connectionId },
      select: { id: true, eventType: true, status: true, attemptCount: true, recoveryCount: true, nextAttemptAt: true, deliveredAt: true, lastRecoveredAt: true, lastError: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);
  return { deliveryHealth: Object.fromEntries(groups.map((group) => [group.status, group._count._all])), events };
}

export async function POST(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can dispatch integrations." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse({ ...body, action: body?.action || "DELIVER_DUE" });
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid delivery action and provide a recovery reason of at least 8 characters." }, { status: 400 });
  const { connectionId } = await params;
  const connection = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) return NextResponse.json({ error: "Integration not found." }, { status: 404 });
  if (connection.kind !== "OUTGOING_WEBHOOK") return NextResponse.json({ error: "Only outgoing webhooks have a delivery queue." }, { status: 409 });
  if (connection.status === "REVOKED" || connection.status === "DISCONNECTED") return NextResponse.json({ error: "Reconnect this integration before dispatching events." }, { status: 409 });
  if (parsed.data.action === "RECOVER_ABANDONED") {
    const recovery = await recoverAbandonedWebhookEvents(prisma, { connectionId, limit: 10 });
    await prisma.auditLog.create({ data: { organisationId: connection.organisationId, actorUserId: access.user.id, action: "INTEGRATION_ABANDONED_RECOVERY_QUEUED", entityType: "IntegrationConnection", entityId: connection.id, details: { recovered: recovery.recovered, note: parsed.data.note } } });
    return NextResponse.json({ action: parsed.data.action, ...recovery, ...(await connectionDeliveryState(connectionId)) });
  }
  const result = await processOutgoingWebhookBatch(prisma, { connectionId, limit: 10 });
  await prisma.auditLog.create({ data: { organisationId: connection.organisationId, actorUserId: access.user.id, action: "INTEGRATION_DISPATCH_RUN", entityType: "IntegrationConnection", entityId: connection.id, details: result } });
  return NextResponse.json({ action: parsed.data.action, attempted: result.claimed, ...result, ...(await connectionDeliveryState(connectionId)) });
}

