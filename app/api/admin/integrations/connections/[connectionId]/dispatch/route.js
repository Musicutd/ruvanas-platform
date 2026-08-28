import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { deliverWebhookEvent } from "@/lib/outgoing-webhook-service";

export async function POST(_request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can dispatch integrations." }, { status: 403 });
  const { connectionId } = await params;
  const connection = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) return NextResponse.json({ error: "Integration not found." }, { status: 404 });
  if (connection.status === "REVOKED" || connection.status === "DISCONNECTED") return NextResponse.json({ error: "Reconnect this integration before dispatching events." }, { status: 409 });
  const events = await prisma.outgoingWebhookEvent.findMany({ where: { connectionId, status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 10 });
  const results = [];
  for (const event of events) {
    try { results.push(await deliverWebhookEvent(prisma, event.id)); }
    catch (error) { results.push({ id: event.id, status: "FAILED", lastError: error instanceof Error ? error.message : "Delivery failed." }); }
  }
  await prisma.auditLog.create({ data: { organisationId: connection.organisationId, actorUserId: access.user.id, action: "INTEGRATION_DISPATCH_RUN", entityType: "IntegrationConnection", entityId: connection.id, details: { attempted: results.length } } });
  return NextResponse.json({ attempted: results.length, delivered: results.filter((item) => item.status === "DELIVERED").length, results });
}

