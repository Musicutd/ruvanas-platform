import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

const ALLOWED_STATUSES = ["DRAFT", "ACTIVE", "PAUSED"];

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const body = await request.json();
    const nextStatus = body.status;

    if (!ALLOWED_STATUSES.includes(nextStatus)) {
      return NextResponse.json(
        {
          error: "Invalid channel status."
        },
        {
          status: 400
        }
      );
    }

    const channel = await prisma.channel.findUnique({
      where: {
        id: params.channelId
      },
      include: {
        station: {
          include: {
            streamConfig: true
          }
        },
        zoneAssignments: {
          select: {
            id: true
          }
        }
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

    if (nextStatus === "ACTIVE") {
      const hasConfiguredStream = Boolean(
        channel.station?.streamConfig?.streamUrl
      );

      if (!channel.station) {
        return NextResponse.json(
          {
            error:
              "Link a technical station before activating this channel."
          },
          {
            status: 400
          }
        );
      }

      if (!hasConfiguredStream) {
        return NextResponse.json(
          {
            error:
              "Configure the linked technical station before activating this channel."
          },
          {
            status: 400
          }
        );
      }

      if (channel.zoneAssignments.length === 0) {
        return NextResponse.json(
          {
            error:
              "Assign this channel to at least one retail zone before activating it."
          },
          {
            status: 400
          }
        );
      }
    }

    const updatedChannel = await prisma.channel.update({
      where: {
        id: channel.id
      },
      data: {
        status: nextStatus
      },
      select: {
        id: true,
        name: true,
        status: true
      }
    });

    return NextResponse.json({
      success: true,
      channel: updatedChannel
    });
  } catch (error) {
    console.error("Channel status update error:", error);

    return NextResponse.json(
      {
        error: "Unable to update the channel status."
      },
      {
        status: 500
      }
    );
  }
}
