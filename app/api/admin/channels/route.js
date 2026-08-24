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

function cleanOptionalText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned || null;
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const body = await request.json();

    const organisationId = cleanOptionalText(body.organisationId);
    const brandId = cleanOptionalText(body.brandId);
    const stationId = cleanOptionalText(body.stationId);
    const name = cleanOptionalText(body.name);
    const submittedSlug = cleanOptionalText(body.slug);
    const description = cleanOptionalText(body.description);

    if (!organisationId) {
      return NextResponse.json(
        { error: "Organisation is required." },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: "Channel name is required." },
        { status: 400 }
      );
    }

    const slug = makeSlug(submittedSlug || name);

    if (!slug) {
      return NextResponse.json(
        { error: "Please provide a valid channel slug." },
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

    if (stationId) {
      const station = await prisma.station.findFirst({
        where: {
          id: stationId,
          organisationId
        }
      });

      if (!station) {
        return NextResponse.json(
          {
            error:
              "The selected technical station does not belong to this organisation."
          },
          { status: 400 }
        );
      }
    }

    const existingChannel = await prisma.channel.findUnique({
      where: {
        organisationId_slug: {
          organisationId,
          slug
        }
      }
    });

    if (existingChannel) {
      return NextResponse.json(
        {
          error:
            "A channel with this slug already exists for the selected organisation."
        },
        { status: 409 }
      );
    }

    const channel = await prisma.channel.create({
      data: {
        organisationId,
        brandId: brandId || null,
        stationId: stationId || null,
        name,
        slug,
        description,
        status: "DRAFT"
      }
    });

    return NextResponse.json(
      {
        ok: true,
        channel: {
          id: channel.id,
          name: channel.name,
          slug: channel.slug,
          status: channel.status
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create Ruvanas channel error:", error);

    return NextResponse.json(
      { error: "Unable to create the Ruvanas channel." },
      { status: 500 }
    );
  }
}
