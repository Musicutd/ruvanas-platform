import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const { locationId, zoneId } = params;
    const body = await request.json();
    const channelId = body?.channelId;

    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json(
        {
          error: "channelId is required."
        },
        {
          status: 400
        }
      );
    }

    const zone = await prisma.zone.findUnique({
      where: {
        id: zoneId
      },
      select: {
        id: true,
        locationId: true
      }
    });

    if (!zone || zone.locationId !== locationId) {
      return NextResponse.json(
        {
          error: "Zone not found for this location."
        },
        {
          status: 404
        }
      );
    }

    const location = await prisma.location.findUnique({
      where: {
        id: locationId
      },
      select: {
        organisationId: true
      }
    });

    if (!location) {
      return NextResponse.json(
        {
          error: "Location not found."
        },
        {
          status: 404
        }
      );
    }

    const channel = await prisma.channel.findUnique({
      where: {
        id: channelId
      },
      select: {
        id: true,
        organisationId: true,
        name: true
      }
    });

    if (!channel) {
      return NextResponse.json(
        {
          error: "Channel not found."
        },
        {
          status: 404
        }
      );
    }

    if (channel.organisationId !== location.organisationId) {
      return NextResponse.json(
        {
          error: "Channel does not belong to this organisation."
        },
        {
          status: 403
        }
      );
    }

    const assignment = await prisma.channelAssignment.create({
      data: {
        zoneId,
        channelId
      }
    });

    return NextResponse.json(
      {
        assignment
      },
      {
        status: 201
      }
    );
  } catch (error) {
    console.error("ZONE_CHANNEL_ASSIGNMENT_ERROR", error);

    return NextResponse.json(
      {
        error: "Unable to assign channel. Please try again."
      },
      {
        status: 500
      }
    );
  }
}
