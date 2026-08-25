import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

function makeSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const locationId = params.locationId;
    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const submittedSlug =
      typeof body.slug === "string" ? body.slug.trim() : "";

    if (!locationId) {
      return NextResponse.json(
        { error: "Location ID is required." },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: "Zone name is required." },
        { status: 400 }
      );
    }

    const slug = makeSlug(submittedSlug || name);

    if (!slug) {
      return NextResponse.json(
        { error: "Please provide a valid zone slug." },
        { status: 400 }
      );
    }

    const location = await prisma.location.findUnique({
      where: {
        id: locationId
      }
    });

    if (!location) {
      return NextResponse.json(
        { error: "Retail location not found." },
        { status: 404 }
      );
    }

    const existingZone = await prisma.zone.findUnique({
      where: {
        locationId_slug: {
          locationId,
          slug
        }
      }
    });

    if (existingZone) {
      return NextResponse.json(
        {
          error:
            "A zone with this name or slug already exists at this retail location."
        },
        { status: 409 }
      );
    }

    const zone = await prisma.$transaction(async (tx) => {
      const createdZone = await tx.zone.create({
        data: {
          locationId,
          name,
          slug,
          status: "ACTIVE"
        }
      });

      await tx.auditLog.create({
        data: {
          organisationId: location.organisationId,
          actorUserId: access.user.id,
          action: "ZONE_CREATED",
          entityType: "Zone",
          entityId: createdZone.id,
          details: { locationId, name, slug }
        }
      });

      return createdZone;
    });

    return NextResponse.json(
      {
        ok: true,
        zone: {
          id: zone.id,
          name: zone.name,
          slug: zone.slug,
          status: zone.status
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create retail audio zone error:", error);

    return NextResponse.json(
      { error: "Unable to create the audio zone." },
      { status: 500 }
    );
  }
}

