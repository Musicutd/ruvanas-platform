import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { normaliseProductionScriptPayload, productionPermissions } from "@/lib/production-orders.mjs";
import { requireActiveStudio } from "@/lib/studio-access";

export async function POST(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const permissions = productionPermissions({ platformRole: access.user.role, membershipRole: access.membership.role });
  if (!permissions.canProduce) return NextResponse.json({ error: "Only Ruvanas production staff can create script versions." }, { status: 403 });

  let input;
  try { input = normaliseProductionScriptPayload(await request.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Provide a valid production script." }, { status: 400 }); }

  const order = await prisma.productionOrder.findFirst({
    where: { id: String(params.orderId || ""), organisationId: access.organisation.id },
    select: { id: true, status: true, scripts: { orderBy: { version: "desc" }, take: 1, select: { version: true } } }
  });
  if (!order) return NextResponse.json({ error: "The production order was not found." }, { status: 404 });
  if (!["IN_PRODUCTION", "CHANGES_REQUESTED"].includes(order.status)) return NextResponse.json({ error: "Scripts can be added only while an order is in production or being revised." }, { status: 409 });

  const version = (order.scripts[0]?.version || 0) + 1;
  try {
    const script = await prisma.$transaction(async (tx) => {
      const created = await tx.productionScriptVersion.create({
        data: { organisationId: access.organisation.id, orderId: order.id, createdByUserId: access.user.id, version, ...input },
        include: { createdBy: { select: { id: true, name: true, email: true } } }
      });
      await tx.productionOrderEvent.create({
        data: { organisationId: access.organisation.id, orderId: order.id, actorUserId: access.user.id, eventType: "SCRIPT_VERSION_CREATED", note: `Script version ${version} (${input.languageCode}) created.` }
      });
      await tx.auditLog.create({
        data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "PRODUCTION_SCRIPT_VERSION_CREATED", entityType: "ProductionScriptVersion", entityId: created.id, details: { orderId: order.id, version, languageCode: input.languageCode } }
      });
      return created;
    });
    return NextResponse.json({ script }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "Another script version was created at the same time. Refresh and try again." }, { status: 409 });
    throw error;
  }
}

