import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const { locationId } = params;

    const location = await prisma.location.findUnique({
      where: {
        id: locationId
      },
      include: {
        zones: {
          include: {
            channelAssignments: {
              where: {
                activeTo: null
              },
              select: {
                id: true
              }
            }
          }
        }
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

    if (location.status === "ACTIVE") {
      return NextResponse.json({
        location
      });
    }

    if (location.zones.length === 0) {
      return NextResponse.json(
        {
          error: "Add at least one audio zone before activating this location."
        },
        {
          status: 400
        }
      );
    }

    const zonesWithoutChannels = location.zones.filter(
      (zone) => zone.channelAssignments.length === 0
    );

    if (zonesWithoutChannels.length > 0) {
      return NextResponse.json(
        {
          error:
            "Assign a channel to every audio zone before activating this location."
        },
        {
          status: 400
        }
      );
    }

    const updatedLocation = await prisma.location.update({
      where: {
        id: location.id
      },
      data: {
        status: "ACTIVE"
      }
    });

    return NextResponse.json({
      location: updatedLocation
    });
  } catch (error) {
    console.error("LOCATION_ACTIVATION_ERROR", error);

    return NextResponse.json(
      {
        error: "Unable to activate this location. Please try again."
      },
      {
        status: 500
      }
    );
  }
}
