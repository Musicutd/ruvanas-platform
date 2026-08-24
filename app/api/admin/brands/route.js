import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

function makeSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const body = await request.json();
    const organisationId = body?.organisationId;
    const name = body?.name?.trim();

    if (!organisationId || typeof organisationId !== "string") {
      return NextResponse.json(
        {
          error: "Please select an organisation."
        },
        {
          status: 400
        }
      );
    }

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        {
          error: "Please enter a brand name."
        },
        {
          status: 400
        }
      );
    }

    const slug = makeSlug(name);

    if (!slug) {
      return NextResponse.json(
        {
          error: "Please enter a valid brand name."
        },
        {
          status: 400
        }
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
          error: "The selected organisation was not found."
        },
        {
          status: 404
        }
      );
    }

    const existingBrand = await prisma.brand.findUnique({
      where: {
        organisationId_slug: {
          organisationId,
          slug
        }
      },
      select: {
        id: true
      }
    });

    if (existingBrand) {
      return NextResponse.json(
        {
          error: "A brand with this name already exists in this organisation."
        },
        {
          status: 409
        }
      );
    }

    const brand = await prisma.brand.create({
      data: {
        organisationId,
        name,
        slug
      }
    });

    return NextResponse.json(
      {
        brand
      },
      {
        status: 201
      }
    );
  } catch (error) {
    console.error("BRAND_CREATE_ERROR", error);

    return NextResponse.json(
      {
        error: "Unable to create brand. Please try again."
      },
      {
        status: 500
      }
    );
  }
}
