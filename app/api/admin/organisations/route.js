import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function makeSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const name = body?.name?.trim();

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        {
          error: "Please enter an organisation name."
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
          error: "Please enter a valid organisation name."
        },
        {
          status: 400
        }
      );
    }

    const existingOrganisation = await prisma.organisation.findUnique({
      where: {
        slug
      },
      select: {
        id: true
      }
    });

    if (existingOrganisation) {
      return NextResponse.json(
        {
          error: "An organisation with this name already exists."
        },
        {
          status: 409
        }
      );
    }

    const organisation = await prisma.organisation.create({
      data: {
        name,
        slug
      }
    });

    return NextResponse.json(
      {
        organisation
      },
      {
        status: 201
      }
    );
  } catch (error) {
    console.error("ORGANISATION_CREATE_ERROR", error);

    return NextResponse.json(
      {
        error: "Unable to create organisation. Please try again."
      },
      {
        status: 500
      }
    );
  }
}
