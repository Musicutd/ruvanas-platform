import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const { locationId, zoneId } = params;
    const body = await request.json();
    const channelId = body?.channelId;

    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json(
        { error: "channelId is required." },
        { status: 400 }
      );
    }

    const zone = await prisma.zone.findFirst({
      where: {
        id: zoneId,
        locationId
      }
    });

    if (!zone) {
      return NextResponse.json(
        { error: "Zone not found for this location." },
        { status: 404 }
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
        { error: "Location not found." },
        { status: 404 }
      );
    }

    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        organisationId: location.organisationId,
        status: {
          not: "ARCHIVED"
        }
      }
    });

    if (!channel) {
      return NextResponse.json(
        { error: "Channel is not available for this organisation." },
        { status: 404 }
      );
    }

    const assignment = await prisma.$transaction(async (transaction) => {
      await transaction.channelAssignment.updateMany({
        where: {
          zoneId,
          status: "ACTIVE"
        },
        data: {
          status: "ARCHIVED"
        }
      });

      return transaction.channelAssignment.create({
        data: {
          zoneId,
          channelId,
          status: "ACTIVE"
        },
        include: {
          channel: {
            include: {
              station: {
                include: {
                  streamConfig: true
                }
              }
            }
          }
        }
      });
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
    console.error("Error assigning channel to zone:", error);

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Unable to assign channel."
      },
      {
        status: 500
      }
    );
  }
}
