import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { productionPermissions } from "@/lib/production-orders.mjs";
import { requireActiveStudio } from "@/lib/studio-access";

const assignmentSchema = z.object({ userId: z.string().cuid().nullable() });

export async function PATCH(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const permissions = productionPermissions({ platformRole: access.user.role, membershipRole: access.membership.role });
  if (!permissions.canProduce) return NextResponse.json({ error: "Only Ruvanas production staff can assign Studio orders." }, { status: 403 });
  const parsed = assignmentSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid Ruvanas production assignee." }, { status: 400 });

  const order = await prisma.productionOrder.findFirst({
    where: { id: String(params.orderId || ""), organisationId: access.organisation.id },
    select: { id: true, assignedToUserId: true, status: true }
  });
  if (!order) return NextResponse.json({ error: "The production order was not found." }, { status: 404 });
  if (["DELIVERED", "CANCELLED"].includes(order.status)) return NextResponse.json({ error: "A completed order cannot be reassigned." }, { status: 409 });

  const assignee = parsed.data.userId ? await prisma.user.findFirst({
    where: { id: parsed.data.userId, role: { in: ["SUPER_ADMIN", "SUPPORT"] } },
    select: { id: true, name: true, email: true, role: true }
  }) : null;
  if (parsed.data.userId && !assignee) return NextResponse.json({ error: "The selected Ruvanas staff member was not found." }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.productionOrder.update({ where: { id: order.id }, data: { assignedToUserId: assignee?.id || null } });
    await tx.productionOrderEvent.create({
      data: { organisationId: access.organisation.id, orderId: order.id, actorUserId: access.user.id, eventType: "ASSIGNMENT_CHANGED", note: assignee ? `Assigned to ${assignee.name || assignee.email}.` : "Production assignment cleared." }
    });
    await tx.auditLog.create({
      data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "PRODUCTION_ORDER_ASSIGNED", entityType: "ProductionOrder", entityId: order.id, details: { previousUserId: order.assignedToUserId, assignedToUserId: assignee?.id || null } }
    });
  });
  return NextResponse.json({ assignedTo: assignee });
}

