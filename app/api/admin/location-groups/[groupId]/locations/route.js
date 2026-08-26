import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  findLocationsOutsideOrganisation,
  normalizeLocationIds
} from "@/lib/location-groups.mjs";

export async function PUT(request, { params }) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const group = await prisma.locationGroup.findUnique({
      where: { id: params.groupId },
      select: { id: true, organisationId: true }
    });

    if (!group) {
      return NextResponse.json(
        { error: "Location group not found." },
        { status: 404 }
      );
    }

    const body = await request.json();
    const locationIds = normalizeLocationIds(body.locationIds);
    const locations = await prisma.location.findMany({
      where: {
        id: { in: locationIds },
        organisationId: group.organisationId
      },
      select: { id: true }
    });
    const invalidIds = findLocationsOutsideOrganisation(locationIds, locations);

    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: "One or more locations do not belong to this organisation." },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.locationGroupMember.deleteMany({
        where: { locationGroupId: group.id }
      });

      if (locationIds.length > 0) {
        await tx.locationGroupMember.createMany({
          data: locationIds.map((locationId) => ({
            locationGroupId: group.id,
            locationId
          }))
        });
      }

      await tx.auditLog.create({
        data: {
          organisationId: group.organisationId,
          actorUserId: access.user.id,
          action: "LOCATION_GROUP_MEMBERS_UPDATED",
          entityType: "LocationGroup",
          entityId: group.id,
          details: { locationIds, locationCount: locationIds.length }
        }
      });
    });

    return NextResponse.json({ ok: true, locationIds });
  } catch (error) {
    console.error("Update location group members error:", error);
    return NextResponse.json(
      { error: "Unable to update the location group." },
      { status: 500 }
    );
  }
}

