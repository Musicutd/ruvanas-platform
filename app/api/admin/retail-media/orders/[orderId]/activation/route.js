import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";
import { loadCrossMediaOrder, prepareCrossMediaReadiness } from "@/lib/retail-media-cross-media-service";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { orderId } = await params;
    const order = await loadCrossMediaOrder(orderId);
    if (!order) return NextResponse.json({ error: "Retail-media order not found." }, { status: 404 });
    const access = await requireRetailMediaOrganisation(order.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const readiness = await prepareCrossMediaReadiness(order);
    return NextResponse.json({
      order: {
        id: order.id,
        name: order.name,
        status: order.status,
        fulfilledAt: order.fulfilledAt,
        fulfilmentRevision: order.fulfilmentRevision,
        fulfilledBy: order.fulfilledBy
      },
      readiness
    });
  } catch (error) {
    console.error("Cross-media readiness error:", error);
    return NextResponse.json({ error: "Unable to review cross-media readiness." }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    if (String(body.action || "").toUpperCase() !== "ACTIVATE") {
      return NextResponse.json({ error: "Choose the cross-media activation action." }, { status: 400 });
    }
    const order = await loadCrossMediaOrder(orderId);
    if (!order) return NextResponse.json({ error: "Retail-media order not found." }, { status: 404 });
    const access = await requireRetailMediaOrganisation(order.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    if (order.status !== "APPROVED") return NextResponse.json({ error: "Only an approved order can be activated for delivery." }, { status: 409 });
    const readiness = await prepareCrossMediaReadiness(order);
    if (!readiness.canActivate) {
      return NextResponse.json({ error: "Resolve every audio and visual readiness blocker before activation.", readiness }, { status: 409 });
    }
    const fulfilledAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.retailMediaOrder.updateMany({
        where: { id: order.id, status: "APPROVED" },
        data: {
          status: "FULFILLED",
          fulfilledAt,
          fulfilledByUserId: access.user.id,
          fulfilmentRevision: { increment: 1 },
          fulfilmentConfigurationHash: readiness.configurationHash
        }
      });
      if (result.count !== 1) throw new Error("The order changed while activation was being recorded.");
      await tx.auditLog.create({
        data: {
          organisationId: order.organisationId,
          actorUserId: access.user.id,
          action: "RETAIL_MEDIA_CROSS_MEDIA_ACTIVATED",
          entityType: "RetailMediaOrder",
          entityId: order.id,
          details: {
            configurationHash: readiness.configurationHash,
            audioRequired: readiness.audio.required,
            visualRequired: readiness.visual.required,
            evidenceBoundary: readiness.evidenceNotice
          }
        }
      });
      return tx.retailMediaOrder.findUnique({
        where: { id: order.id },
        select: { id: true, name: true, status: true, fulfilledAt: true, fulfilmentRevision: true, fulfilmentConfigurationHash: true }
      });
    });
    return NextResponse.json({ order: updated, readiness: { ...readiness, canActivate: false } });
  } catch (error) {
    console.error("Cross-media activation error:", error);
    const conflict = error instanceof Error && error.message.includes("changed while activation");
    return NextResponse.json({ error: conflict ? error.message : "Unable to activate cross-media delivery." }, { status: conflict ? 409 : 500 });
  }
}
