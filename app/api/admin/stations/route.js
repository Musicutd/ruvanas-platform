import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import slugify from "@/lib/slugify";

function badRequest(error) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const adminUser = access.user;

    const body = await request.json();

    const organisationId =
      typeof body.organisationId === "string"
        ? body.organisationId.trim()
        : "";

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const suppliedSlug =
      typeof body.slug === "string"
        ? body.slug.trim()
        : "";

    const description =
      typeof body.description === "string"
        ? body.description.trim()
        : "";

    const listenerLimit = Number(body.listenerLimit);
    const storageLimitGb = Number(body.storageLimitGb);
    const maxBitrateKbps = Number(body.maxBitrateKbps);

    if (!organisationId || !name) {
      return badRequest("Organisation and station name are required.");
    }

    if (
      !Number.isInteger(listenerLimit) ||
      listenerLimit < 1 ||
      !Number.isInteger(storageLimitGb) ||
      storageLimitGb < 1 ||
      !Number.isInteger(maxBitrateKbps) ||
      maxBitrateKbps < 8 ||
      maxBitrateKbps > 320
    ) {
      return badRequest(
        "Listener limit, storage limit, and bitrate must contain valid values."
      );
    }

    const organisation = await prisma.organisation.findUnique({
      where: {
        id: organisationId
      },
      select: {
        id: true
      }
    });

    if (!organisation) {
      return NextResponse.json(
        {
          error: "Organisation not found."
        },
        {
          status: 404
        }
      );
    }

    const slug = slugify(suppliedSlug || name);

    if (!slug) {
      return badRequest("Enter a valid station name or slug.");
    }

    const existingStation = await prisma.station.findUnique({
      where: {
        slug
      },
      select: {
        id: true
      }
    });

    if (existingStation) {
      return NextResponse.json(
        {
          error: "That station slug is already in use."
        },
        {
          status: 409
        }
      );
    }

    const station = await prisma.$transaction(async (tx) => {
      const createdStation = await tx.station.create({
        data: {
          organisationId,
          name,
          slug,
          description: description || null,
          listenerLimit,
          storageLimitGb,
          maxBitrateKbps
        }
      });

      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: adminUser.id,
          action: "STATION_CREATED",
          entityType: "Station",
          entityId: createdStation.id,
          details: {
            name: createdStation.name,
            slug: createdStation.slug,
            listenerLimit: createdStation.listenerLimit,
            storageLimitGb: createdStation.storageLimitGb,
            maxBitrateKbps: createdStation.maxBitrateKbps
          }
        }
      });

      return createdStation;
    });

    return NextResponse.json(
      {
        id: station.id,
        name: station.name,
        slug: station.slug
      },
      {
        status: 201
      }
    );
  } catch (error) {
    console.error("Error creating station:", error);

    if (error?.code === "P2002") {
      return NextResponse.json(
        {
          error: "That station slug is already in use."
        },
        {
          status: 409
        }
      );
    }

    return NextResponse.json(
      {
        error: "Unable to create station."
      },
      {
        status: 500
      }
    );
  }
}
