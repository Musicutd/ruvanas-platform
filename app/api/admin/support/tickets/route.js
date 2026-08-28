import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";
import { assertSupportTransition, generateOperationalReference } from "@/lib/compliance-operations.mjs";

const createSchema = z.object({
  organisationId: z.string().min(1).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  subject: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(8_000),
  linkedEntityType: z.string().trim().max(80).nullable().optional(),
  linkedEntityId: z.string().trim().max(200).nullable().optional(),
  incidentStartedAt: z.string().datetime().nullable().optional()
});

const updateSchema = z.object({
  ticketId: z.string().min(1),
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().min(1).nullable().optional()
});

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid support ticket." }, { status: 400 });
    const input = parsed.data;
    if (input.organisationId) {
      const organisation = await prisma.organisation.findUnique({ where: { id: input.organisationId }, select: { id: true } });
      if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    }
    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({ data: {
        organisationId: input.organisationId || null,
        createdByUserId: access.user.id,
        reference: generateOperationalReference("SUP"),
        priority: input.priority,
        subject: input.subject,
        description: input.description,
        linkedEntityType: input.linkedEntityType || null,
        linkedEntityId: input.linkedEntityId || null,
        incidentStartedAt: input.incidentStartedAt ? new Date(input.incidentStartedAt) : null
      } });
      await tx.auditLog.create({ data: { organisationId: input.organisationId || null, actorUserId: access.user.id, action: "SUPPORT_TICKET_CREATED", entityType: "SupportTicket", entityId: created.id, details: { reference: created.reference, priority: created.priority, linkedEntityType: created.linkedEntityType, linkedEntityId: created.linkedEntityId, requestId: getRequestId(request) } } });
      return created;
    });
    return NextResponse.json({ ok: true, ticket }, { status: 201 });
  } catch (error) {
    console.error("Create support ticket error:", error);
    return NextResponse.json({ error: "Unable to create the support ticket." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid support-ticket update." }, { status: 400 });
    const input = parsed.data;
    const existing = await prisma.supportTicket.findUnique({ where: { id: input.ticketId } });
    if (!existing) return NextResponse.json({ error: "Support ticket not found." }, { status: 404 });
    assertSupportTransition(existing.status, input.status);
    if (input.assignedToUserId) {
      const assignee = await prisma.user.findFirst({ where: { id: input.assignedToUserId, role: { in: ["SUPER_ADMIN", "SUPPORT"] } }, select: { id: true } });
      if (!assignee) return NextResponse.json({ error: "The assignee must be a platform administrator." }, { status: 400 });
    }
    const now = new Date();
    const ticket = await prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicket.update({ where: { id: existing.id }, data: {
        status: input.status,
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assignedToUserId !== undefined ? { assignedToUserId: input.assignedToUserId } : {}),
        resolvedAt: ["RESOLVED", "CLOSED"].includes(input.status) ? (existing.resolvedAt || now) : null
      } });
      await tx.auditLog.create({ data: { organisationId: existing.organisationId, actorUserId: access.user.id, action: "SUPPORT_TICKET_UPDATED", entityType: "SupportTicket", entityId: existing.id, details: { fromStatus: existing.status, toStatus: updated.status, priority: updated.priority, assignedToUserId: updated.assignedToUserId, requestId: getRequestId(request) } } });
      return updated;
    });
    return NextResponse.json({ ok: true, ticket });
  } catch (error) {
    if (error instanceof Error && error.message.includes("cannot move")) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Update support ticket error:", error);
    return NextResponse.json({ error: "Unable to update the support ticket." }, { status: 500 });
  }
}


