import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { productionPermissions, transitionProductionOrder } from "@/lib/production-orders.mjs";
import { requireActiveStudio } from "@/lib/studio-access";

const actionSchema = z.object({
  action: z.enum(["SUBMIT", "START_PRODUCTION", "RESUME_PRODUCTION", "REQUEST_APPROVAL", "REQUEST_CHANGES", "APPROVE", "DELIVER", "CANCEL"]),
  note: z.string().trim().max(2000).optional().nullable()
});

export async function PATCH(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid production action." }, { status: 400 });
  const order = await prisma.productionOrder.findFirst({
    where: { id: String(params.orderId || ""), organisationId: access.organisation.id },
    select: { id: true, status: true, _count: { select: { files: { where: { kind: "FINAL_MASTER" } } } } }
  });
  if (!order) return NextResponse.json({ error: "The production order was not found." }, { status: 404 });
  if (parsed.data.action === "DELIVER" && order._count.files < 1) {
    return NextResponse.json({ error: "Upload a final master before marking this order as delivered." }, { status: 409 });
  }

  let transition;
  try {
    transition = transitionProductionOrder({
      currentStatus: order.status,
      action: parsed.data.action,
      note: parsed.data.note,
      permissions: productionPermissions({ platformRole: access.user.role, membershipRole: access.membership.role })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "This production action is not allowed.";
    return NextResponse.json({ error: message }, { status: message.includes("permission") ? 403 : 409 });
  }

  const { note, ...statusData } = transition;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.productionOrder.updateMany({
        where: { id: order.id, organisationId: access.organisation.id, status: order.status },
        data: statusData
      });
      if (result.count !== 1) throw new Error("ORDER_CHANGED");
      const item = await tx.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
      await tx.productionOrderEvent.create({
        data: {
          organisationId: access.organisation.id,
          orderId: order.id,
          actorUserId: access.user.id,
          eventType: "STATUS_CHANGED",
          fromStatus: order.status,
          toStatus: item.status,
          note
        }
      });
      if (parsed.data.action === "REQUEST_CHANGES") {
        await tx.productionRevisionRequest.create({
          data: { organisationId: access.organisation.id, orderId: order.id, requestedByUserId: access.user.id, message: note }
        });
        await tx.productionOrderEvent.create({
          data: { organisationId: access.organisation.id, orderId: order.id, actorUserId: access.user.id, eventType: "REVISION_REQUESTED", fromStatus: order.status, toStatus: item.status, note }
        });
      }
      if (parsed.data.action === "REQUEST_APPROVAL") {
        const resolved = await tx.productionRevisionRequest.updateMany({
          where: { organisationId: access.organisation.id, orderId: order.id, status: "OPEN" },
          data: { status: "RESOLVED", resolvedByUserId: access.user.id, resolvedAt: new Date() }
        });
        if (resolved.count) {
          await tx.productionOrderEvent.create({
            data: { organisationId: access.organisation.id, orderId: order.id, actorUserId: access.user.id, eventType: "REVISION_RESOLVED", fromStatus: order.status, toStatus: item.status, note: `${resolved.count} revision request${resolved.count === 1 ? "" : "s"} resolved by the new approval submission.` }
          });
        }
      }
      await tx.auditLog.create({
        data: {
          organisationId: access.organisation.id,
          actorUserId: access.user.id,
          action: `PRODUCTION_ORDER_${parsed.data.action}`,
          entityType: "ProductionOrder",
          entityId: order.id,
          details: { fromStatus: order.status, toStatus: item.status, note }
        }
      });
      return item;
    });
    return NextResponse.json({ order: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_CHANGED") {
      return NextResponse.json({ error: "This order changed while you were reviewing it. Refresh and try again." }, { status: 409 });
    }
    throw error;
  }
}

