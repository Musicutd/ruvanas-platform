import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { appendProductionCreditEntry } from "@/lib/production-credit-service";
import { requireActiveStudio } from "@/lib/studio-access";

const fundingSchema = z.object({
  action: z.literal("AUTHORISE_PAID_ADD_ON"),
  externalReference: z.string().trim().min(3).max(240),
  note: z.string().trim().max(1000).optional().nullable()
});

export async function PATCH(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can authorise paid production add-ons." }, { status: 403 });
  const parsed = fundingSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide the paid add-on authorisation reference." }, { status: 400 });

  const order = await prisma.productionOrder.findFirst({
    where: { id: String(params.orderId || ""), organisationId: access.organisation.id },
    select: { id: true, status: true, fundingType: true, fundingStatus: true }
  });
  if (!order) return NextResponse.json({ error: "The production order was not found." }, { status: 404 });
  if (order.fundingType !== "PAID_ADD_ON") return NextResponse.json({ error: "This order is not a paid add-on." }, { status: 409 });
  if (order.fundingStatus === "RESERVED") return NextResponse.json({ order });
  if (order.fundingStatus !== "PENDING" || order.status !== "SUBMITTED") {
    return NextResponse.json({ error: "Only a submitted, pending paid add-on can be authorised." }, { status: 409 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await appendProductionCreditEntry(tx, {
      organisationId: access.organisation.id,
      orderId: order.id,
      actorUserId: access.user.id,
      entryType: "PURCHASE",
      quantity: 1,
      idempotencyKey: `production-order:${order.id}:purchase`,
      externalReference: parsed.data.externalReference,
      note: parsed.data.note || "Paid production add-on authorised by Ruvanas operations."
    });
    await appendProductionCreditEntry(tx, {
      organisationId: access.organisation.id,
      orderId: order.id,
      actorUserId: access.user.id,
      entryType: "RESERVE",
      quantity: 1,
      idempotencyKey: `production-order:${order.id}:reserve`
    });
    const result = await tx.productionOrder.update({ where: { id: order.id }, data: { fundingStatus: "RESERVED" } });
    await tx.productionOrderEvent.create({
      data: { organisationId: access.organisation.id, orderId: order.id, actorUserId: access.user.id, eventType: "FUNDING_CHANGED", note: `Paid add-on authorised and reserved (${parsed.data.externalReference}).` }
    });
    await tx.auditLog.create({
      data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "PRODUCTION_PAID_ADD_ON_AUTHORISED", entityType: "ProductionOrder", entityId: order.id, details: { externalReference: parsed.data.externalReference } }
    });
    return result;
  });
  return NextResponse.json({ order: updated });
}


