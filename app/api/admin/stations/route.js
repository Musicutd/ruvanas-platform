import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request) {
  try {
    const body = await request.json();

    const {
      organisationId,
      name,
      slug,
      description,
      listenerLimit,
      storageLimitGb,
      maxBitrateKbps
    } = body;

    if (!organisationId || !name || !slug) {
      return NextResponse.json(
        {
          error: "Missing required fields."
        },
        {
          status: 400
        }
      );
    }

    const station = await prisma.station.create({
      data: {
        organisationId,
        name,
        slug,
        description,
        listenerLimit,
        storageLimitGb,
        maxBitrateKbps,
        status: "active"
      }
    });

    return NextResponse.json({
      id: station.id,
      name: station.name,
      slug: station.slug
    });
  } catch (error) {
    console.error("Error creating station:", error);
    return NextResponse.json(
      {
        error: "Unable to create the station."
      },
      {
        status: 500
      }
    );
  }
}
