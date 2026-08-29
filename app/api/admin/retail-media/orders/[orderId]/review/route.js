import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";
import { normaliseRetailMediaReview, retailMediaOrderApprovalBlockers } from "@/lib/retail-media.mjs";

export async function PATCH(request, { params }) {
  try {
    const { orderId } = await params;
    let review;
    try { review = normaliseRetailMediaReview(await request.json()); }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const order = await prisma.retailMediaOrder.findUnique({
      where: { id: orderId },
      include: { inventoryPackage: true, advertiser: true, agency: true, creatives: true }
    });
    if (!order) return NextResponse.json({ error: "Retail-media order not found." }, { status: 404 });
    const allowedRoles = review.action === "SUBMIT_ORDER" ? ORGANISATION_CONTENT_ROLES : ORGANISATION_MANAGER_ROLES;
    const access = await requireRetailMediaOrganisation(order.organisationId, allowedRoles);
    if (!access.ok) return accessDenied(access);
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      let result;
      let auditAction;
      if (review.action === "SUBMIT_ORDER") {
        if (order.status !== "DRAFT") throw new Error("Only a draft order can be submitted.");
        if (order.inventoryPackage.status !== "ACTIVE") throw new Error("Activate the inventory package before submitting the order.");
        if (order.advertiser.status !== "ACTIVE" || (order.agency && order.agency.status !== "ACTIVE")) throw new Error("Order partners must be active.");
        const changed = await tx.retailMediaOrder.updateMany({ where: { id: order.id, status: "DRAFT" }, data: { status: "SUBMITTED", submittedAt: now, approvedByUserId: null, approvedAt: null, decisionNote: null } });
        if (changed.count !== 1) throw new Error("The order changed while it was being submitted. Reload and retry.");
        result = await tx.retailMediaOrder.findUnique({ where: { id: order.id } });
        auditAction = "RETAIL_MEDIA_ORDER_SUBMITTED";
      } else if (["APPROVE_CREATIVE", "REJECT_CREATIVE"].includes(review.action)) {
        if (order.status !== "SUBMITTED") throw new Error("Creatives can only be reviewed while the order is submitted.");
        const creative = order.creatives.find((item) => item.id === review.creativeId);
        if (!creative) throw new Error("Creative not found on this order.");
        if (creative.status !== "PENDING") throw new Error("This creative already has a review decision.");
        const status = review.action === "APPROVE_CREATIVE" ? "APPROVED" : "REJECTED";
        const changed = await tx.retailMediaOrderCreative.updateMany({ where: { id: creative.id, orderId: order.id, status: "PENDING" }, data: { status, reviewedById: access.user.id, reviewedAt: now, reviewNote: review.note } });
        if (changed.count !== 1) throw new Error("The creative was reviewed by someone else. Reload to see the decision.");
        result = await tx.retailMediaOrder.findUnique({ where: { id: order.id } });
        auditAction = status === "APPROVED" ? "RETAIL_MEDIA_CREATIVE_APPROVED" : "RETAIL_MEDIA_CREATIVE_REJECTED";
      } else if (review.action === "APPROVE_ORDER") {
        const fresh = await tx.retailMediaOrder.findUnique({ where: { id: order.id }, include: { inventoryPackage: true, creatives: true } });
        const blockers = retailMediaOrderApprovalBlockers(fresh, now);
        if (blockers.length) throw new Error(blockers.join(" "));
        const changed = await tx.retailMediaOrder.updateMany({ where: { id: order.id, status: "SUBMITTED" }, data: { status: "APPROVED", approvedByUserId: access.user.id, approvedAt: now, decisionNote: review.note } });
        if (changed.count !== 1) throw new Error("The order already has a decision. Reload to see its current status.");
        result = await tx.retailMediaOrder.findUnique({ where: { id: order.id } });
        auditAction = "RETAIL_MEDIA_ORDER_APPROVED";
      } else if (review.action === "REJECT_ORDER") {
        if (order.status !== "SUBMITTED") throw new Error("Only a submitted order can be rejected.");
        const changed = await tx.retailMediaOrder.updateMany({ where: { id: order.id, status: "SUBMITTED" }, data: { status: "REJECTED", approvedByUserId: access.user.id, approvedAt: now, decisionNote: review.note } });
        if (changed.count !== 1) throw new Error("The order already has a decision. Reload to see its current status.");
        result = await tx.retailMediaOrder.findUnique({ where: { id: order.id } });
        auditAction = "RETAIL_MEDIA_ORDER_REJECTED";
      } else {
        if (!["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].includes(order.status)) throw new Error("This order can no longer be cancelled.");
        const changed = await tx.retailMediaOrder.updateMany({ where: { id: order.id, status: order.status }, data: { status: "CANCELLED", decisionNote: review.note } });
        if (changed.count !== 1) throw new Error("The order changed while it was being cancelled. Reload and retry.");
        result = await tx.retailMediaOrder.findUnique({ where: { id: order.id } });
        auditAction = "RETAIL_MEDIA_ORDER_CANCELLED";
      }
      await tx.auditLog.create({ data: {
        organisationId: order.organisationId,
        actorUserId: access.user.id,
        action: auditAction,
        entityType: review.action.includes("CREATIVE") ? "RetailMediaOrderCreative" : "RetailMediaOrder",
        entityId: review.action.includes("CREATIVE") ? review.creativeId : order.id,
        details: { orderId: order.id, previousStatus: order.status, action: review.action, noteProvided: Boolean(review.note) }
      } });
      return result;
    });
    return NextResponse.json({ order: updated });
  } catch (error) {
    console.error("Review retail-media order error:", error);
    return NextResponse.json({ error: error.message || "Unable to review the retail-media order." }, { status: 409 });
  }
}
