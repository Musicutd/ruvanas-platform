import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function makeSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanOptionalText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned || null;
}

export async function POST(request) {
  try {
    const body = await request.json();

    const organisationId = cleanOptionalText(body.organisationId);
    const brandId = cleanOptionalText(body.brandId);
    const name = cleanOptionalText(body.name);
    const submittedSlug = cleanOptionalText(body.slug);
    const timezone = cleanOptionalText(body.timezone) || "Europe/Malta";
    const firstZoneName = cleanOptionalText(body.firstZoneName);

    if (!organisationId) {
      return NextResponse.json(
        { error: "Organisation is required." },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: "Location name is required." },
        { status: 400 }
      );
    }

    if (!firstZoneName) {
      return NextResponse.json(
        { error: "First audio-zone name is required." },
        { status: 400 }
      );
    }

    const locationSlug = makeSlug(submittedSlug || name);

    if (!locationSlug) {
      return NextResponse.json(
        { error: "Please provide a valid location slug." },
        { status: 400 }
      );
    }

    const organisation = await prisma.organisation.findUnique({
      where: {
        id: organisationId
      }
    });

    if (!organisation) {
      return NextResponse.json(
        { error: "The selected organisation does not exist." },
        { status: 404 }
      );
    }

    if (brandId) {
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          organisationId
        }
      });

      if (!brand) {
        return NextResponse.json(
          { error: "The selected brand does not belong to this organisation." },
          { status: 400 }
        );
      }
    }

    const existingLocation = await prisma.location.findUnique({
      where: {
        organisationId_slug: {
          organisationId,
          slug: locationSlug
        }
      }
    });

    if (existingLocation) {
      return NextResponse.json(
        {
          error:
            "A location with this slug already exists for the selected organisation."
        },
        { status: 409 }
      );
    }

    const location = await prisma.location.create({
      data: {
        organisationId,
        brandId: brandId || null,
        name,
        slug: locationSlug,
        status: "DRAFT",
        timezone,
        addressLine1: cleanOptionalText(body.addressLine1),
        addressLine2: cleanOptionalText(body.addressLine2),
        city: cleanOptionalText(body.city),
        region: cleanOptionalText(body.region),
        postalCode: cleanOptionalText(body.postalCode),
        countryCode: cleanOptionalText(body.countryCode)?.toUpperCase() || null,
        zones: {
          create: {
            name: firstZoneName,
            slug: makeSlug(firstZoneName) || "main-store",
            status: "ACTIVE"
          }
        }
      },
      include: {
        zones: true
      }
    });

    return NextResponse.json(
      {
        ok: true,
        location: {
          id: location.id,
          name: location.name,
          slug: location.slug,
          zoneId: location.zones[0]?.id ?? null
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create retail location error:", error);

    return NextResponse.json(
      { error: "Unable to create the retail location." },
      { status: 500 }
    );
  }
}
