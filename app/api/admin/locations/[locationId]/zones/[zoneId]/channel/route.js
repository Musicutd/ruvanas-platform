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
          error: "Please select a channel."
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
        organisationId: true
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
          error: "This channel does not belong to this organisation."
        },
        {
          status: 403
        }
      );
    }

    const now = new Date();

    const assignment = await prisma.$transaction(async (transaction) => {
      const existingAssignment = await transaction.channelAssignment.findUnique({
        where: {
          channelId_zoneId: {
            channelId,
            zoneId
          }
        }
      });

      if (existingAssignment?.activeTo === null) {
        return existingAssignment;
      }

      await transaction.channelAssignment.updateMany({
        where: {
          zoneId,
          activeTo: null
        },
        data: {
          activeTo: now
        }
      });

      if (existingAssignment) {
        return transaction.channelAssignment.update({
          where: {
            id: existingAssignment.id
          },
          data: {
            activeFrom: now,
            activeTo: null
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
      }

      return transaction.channelAssignment.create({
        data: {
          channelId,
          zoneId,
          activeFrom: now
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
        status: 200
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
