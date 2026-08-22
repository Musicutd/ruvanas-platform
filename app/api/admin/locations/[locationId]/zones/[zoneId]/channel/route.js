import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const { locationId, zoneId } = params;
    const { channelId } = await request.json();

    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json(
        {
          error: "channelId is required and must be a string."
        },
        {
          status: 400
        }
      );
    }

    const location = await prisma.location.findUnique({
      where: {
        id: locationId
      },
      include: {
        organisation: true
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

    const zone = await prisma.zone.findUnique({
      where: {
        id: zoneId
      }
    });

    if (!zone || zone.locationId !== location.id) {
      return NextResponse.json(
        {
          error: "Zone not found or does not belong to this location."
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
      include: {
        organisation: true
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

    const [updatedZone] = await prisma.$transaction([
      prisma.channelAssignment.updateMany({
        where: {
          zoneId: zone.id,
          status: "ACTIVE"
        },
        data: {
          status: "ARCHIVED"
        }
      }),

      prisma.zone.update({
        where: {
          id: zone.id
        },
        data: {
          channelAssignments: {
            create: {
              channelId: channel.id,
              status: "ACTIVE"
            }
          }
        },
        include: {
          channelAssignments: {
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
          }
        }
      })
    ]);

    return NextResponse.json({
      zone: updatedZone
    });
  } catch (error) {
    console.error("Error assigning channel to zone:", error);
    return NextResponse.json(
      {
        error: "Unable to assign channel."
      },
      {
        status: 500
      }
    );
  }
}
