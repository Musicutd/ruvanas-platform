import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";

const STATUSES = new Set(["DRAFT", "ACTIVE", "ARCHIVED"]);

export async function PATCH(request, { params }) {
  try {
    const { inventoryPackageId } = await params;
    const status = String((await request.json())?.status || "").trim().toUpperCase();
    if (!STATUSES.has(status)) return NextResponse.json({ error: "Inventory status is invalid." }, { status: 400 });
    const record = await prisma.retailMediaInventoryPackage.findUnique({ where: { id: inventoryPackageId }, include: { _count: { select: { targets: true, dayparts: true } } } });
    if (!record) return NextResponse.json({ error: "Inventory package not found." }, { status: 404 });
    const access = await requireRetailMediaOrganisation(record.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    if (status === record.status) return NextResponse.json({ inventoryPackage: record });
    const transitionAllowed =
      (record.status === "DRAFT" && ["ACTIVE", "ARCHIVED"].includes(status)) ||
      (record.status === "ACTIVE" && status === "ARCHIVED");
    if (!transitionAllowed) {
      return NextResponse.json({ error: "This inventory status transition is not allowed." }, { status: 409 });
    }
    if (status === "ACTIVE" && (record._count.targets === 0 || record._count.dayparts === 0)) {
      return NextResponse.json({ error: "Inventory needs at least one target and daypart before activation." }, { status: 409 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.retailMediaInventoryPackage.updateMany({ where: { id: record.id, status: record.status }, data: { status } });
      if (changed.count !== 1) throw new Error("The inventory package changed while it was being updated. Reload and retry.");
      await tx.auditLog.create({ data: { organisationId: record.organisationId, actorUserId: access.user.id, action: "RETAIL_MEDIA_INVENTORY_STATUS_CHANGED", entityType: "RetailMediaInventoryPackage", entityId: record.id, details: { previousStatus: record.status, status } } });
      return tx.retailMediaInventoryPackage.findUnique({ where: { id: record.id } });
    });
    return NextResponse.json({ inventoryPackage: updated });
  } catch (error) {
    console.error("Update retail-media inventory status error:", error);
    return NextResponse.json({ error: "Unable to update the inventory package." }, { status: 500 });
  }
}
