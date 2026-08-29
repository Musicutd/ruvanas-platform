import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";
import { RETAIL_MEDIA_REPORTING_NOTICE } from "@/lib/retail-media.mjs";

function deviceMatchesTargets(device, targets) {
  return targets.some((target) => {
    if (target.targetType === "ZONE") return target.zoneId === device.zoneId;
    if (target.targetType === "BRAND") return target.brandId === device.zone.location.brandId;
    if (target.targetType === "LOCATION_GROUP") return device.zone.location.groupMemberships.some((membership) => membership.locationGroupId === target.locationGroupId);
    return false;
  });
}

export async function PATCH(request, { params }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "LINK").toUpperCase();
    const playlistId = String(body.playlistId || "").trim();
    if (!["LINK", "UNLINK"].includes(action) || !playlistId) return NextResponse.json({ error: "Choose a playlist and a valid fulfilment action." }, { status: 400 });
    const order = await prisma.retailMediaOrder.findUnique({ where: { id: orderId }, include: { inventoryPackage: { include: { targets: true } }, visualCreatives: true } });
    if (!order) return NextResponse.json({ error: "Retail-media order not found." }, { status: 404 });
    const access = await requireRetailMediaOrganisation(order.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    const playlist = await prisma.digitalSignagePlaylist.findFirst({
      where: { id: playlistId, organisationId: order.organisationId },
      include: {
        items: { select: { assetId: true, asset: { select: { status: true } } } },
        devices: { include: { device: { include: { zone: { include: { location: { include: { groupMemberships: true } } } } } } } }
      }
    });
    if (!playlist) return NextResponse.json({ error: "Visual playlist not found in this organisation." }, { status: 404 });
    if (action === "LINK") {
      if (order.status !== "APPROVED") return NextResponse.json({ error: "Only an approved Retail Media order can be linked for visual fulfilment." }, { status: 409 });
      if (playlist.status !== "PUBLISHED") return NextResponse.json({ error: "Publish the visual playlist before linking it to the order." }, { status: 400 });
      if (playlist.retailMediaOrderId && playlist.retailMediaOrderId !== order.id) return NextResponse.json({ error: "This visual playlist is already linked to another order." }, { status: 409 });
      const approvedAssets = new Set(order.visualCreatives.filter((creative) => creative.status === "APPROVED").map((creative) => creative.signageAssetId));
      if (!playlist.items.length || playlist.items.some((item) => !approvedAssets.has(item.assetId) || item.asset.status !== "READY")) return NextResponse.json({ error: "Every playlist item must be an approved visual creative on this order." }, { status: 400 });
      if (!playlist.devices.length || playlist.devices.some(({ device }) => !deviceMatchesTargets(device, order.inventoryPackage.targets))) return NextResponse.json({ error: "Every assigned display must fall inside the order's approved inventory targets." }, { status: 400 });
    } else if (playlist.retailMediaOrderId !== order.id) {
      return NextResponse.json({ error: "This playlist is not linked to the selected order." }, { status: 409 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.digitalSignagePlaylist.update({ where: { id: playlist.id }, data: { retailMediaOrderId: action === "LINK" ? order.id : null, version: { increment: 1 } } });
      await tx.auditLog.create({ data: { organisationId: order.organisationId, actorUserId: access.user.id, action: action === "LINK" ? "RETAIL_MEDIA_VISUAL_FULFILMENT_LINKED" : "RETAIL_MEDIA_VISUAL_FULFILMENT_UNLINKED", entityType: "DigitalSignagePlaylist", entityId: playlist.id, details: { orderId: order.id, playlistId: playlist.id, deviceIds: playlist.devices.map(({ device }) => device.id), visualAssetIds: playlist.items.map((item) => item.assetId) } } });
      return value;
    });
    return NextResponse.json({ playlist: updated, reportingNotice: RETAIL_MEDIA_REPORTING_NOTICE });
  } catch (error) {
    console.error("Retail-media visual fulfilment error:", error);
    return NextResponse.json({ error: "Unable to update visual fulfilment." }, { status: 500 });
  }
}
