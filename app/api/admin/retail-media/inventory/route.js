import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";
import { normaliseRetailMediaInventory } from "@/lib/retail-media.mjs";

export const dynamic = "force-dynamic";

function includeInventory() {
  return {
    targets: { include: { brand: { select: { id: true, name: true } }, locationGroup: { select: { id: true, name: true } }, zone: { select: { id: true, name: true, location: { select: { id: true, name: true } } } } } },
    dayparts: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
    _count: { select: { orders: true } }
  };
}

async function validateTargetOwnership(organisationId, targets) {
  const brandIds = targets.map((item) => item.brandId).filter(Boolean);
  const groupIds = targets.map((item) => item.locationGroupId).filter(Boolean);
  const zoneIds = targets.map((item) => item.zoneId).filter(Boolean);
  const [brandCount, groupCount, zoneCount] = await Promise.all([
    prisma.brand.count({ where: { organisationId, id: { in: brandIds } } }),
    prisma.locationGroup.count({ where: { organisationId, id: { in: groupIds } } }),
    prisma.zone.count({ where: { location: { organisationId }, id: { in: zoneIds } } })
  ]);
  return brandCount === brandIds.length && groupCount === groupIds.length && zoneCount === zoneIds.length;
}

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireRetailMediaOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const inventory = await prisma.retailMediaInventoryPackage.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } },
      include: includeInventory(),
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });
    return NextResponse.json({ inventory });
  } catch (error) {
    console.error("List retail-media inventory error:", error);
    return NextResponse.json({ error: "Unable to load retail-media inventory." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    let input;
    try { input = normaliseRetailMediaInventory(await request.json()); }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const access = await requireRetailMediaOrganisation(input.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    if (!await validateTargetOwnership(input.organisationId, input.targets)) {
      return NextResponse.json({ error: "Every inventory target must belong to the selected organisation." }, { status: 400 });
    }
    const inventoryPackage = await prisma.$transaction(async (tx) => {
      const created = await tx.retailMediaInventoryPackage.create({
        data: {
          organisationId: input.organisationId,
          name: input.name,
          description: input.description,
          priceModel: input.priceModel,
          currencyCode: input.currencyCode,
          unitPriceMinor: input.unitPriceMinor,
          maxPlays: input.maxPlays,
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
          effectiveTo: new Date(`${input.effectiveTo}T00:00:00.000Z`),
          restrictionNotes: input.restrictionNotes,
          createdByUserId: access.user.id,
          targets: { create: input.targets },
          dayparts: { create: input.dayparts }
        },
        include: includeInventory()
      });
      await tx.auditLog.create({ data: {
        organisationId: input.organisationId,
        actorUserId: access.user.id,
        action: "RETAIL_MEDIA_INVENTORY_CREATED",
        entityType: "RetailMediaInventoryPackage",
        entityId: created.id,
        details: { targetCount: input.targets.length, daypartCount: input.dayparts.length, maxPlays: input.maxPlays, priceModel: input.priceModel }
      } });
      return created;
    });
    return NextResponse.json({ inventoryPackage }, { status: 201 });
  } catch (error) {
    console.error("Create retail-media inventory error:", error);
    const duplicate = error?.code === "P2002";
    return NextResponse.json({ error: duplicate ? "This inventory package name is already in use." : "Unable to create the inventory package." }, { status: duplicate ? 409 : 500 });
  }
}
