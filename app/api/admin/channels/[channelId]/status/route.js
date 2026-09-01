import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

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
        },
        organisation: {
          include: {
            subscription: { include: { plan: true, billingContract: true } }
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
      const entitlements = resolveEntitlements(channel.organisation.subscription);
      if (!entitlements.serviceEnabled) {
        return NextResponse.json(
          {
            error: "This organisation's subscription does not currently allow live streams."
          },
          {
            status: 403
          }
        );
      }

      const activeStreamCount = await prisma.channel.count({
        where: {
          organisationId: channel.organisationId,
          status: "ACTIVE",
          id: { not: channel.id }
        }
      });
      if (activeStreamCount >= entitlements.streamLimit) {
        return NextResponse.json(
          {
            error: `This plan allows ${entitlements.streamLimit} simultaneous live stream${entitlements.streamLimit === 1 ? "" : "s"}. Pause another channel or upgrade the plan.`
          },
          {
            status: 409
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

    if (channel.status === nextStatus) {
      return NextResponse.json({
        success: true,
        channel: {
          id: channel.id,
          name: channel.name,
          status: channel.status
        }
      });
    }

    const updatedChannel = await prisma.$transaction(async (tx) => {
      const changedChannel = await tx.channel.update({
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

      await tx.auditLog.create({
        data: {
          organisationId: channel.organisationId,
          actorUserId: access.user.id,
          action: "CHANNEL_STATUS_CHANGED",
          entityType: "Channel",
          entityId: channel.id,
          details: {
            previousStatus: channel.status,
            status: nextStatus,
            delivery: channel.station?.streamConfig?.streamUrl ? "RUVANAS_LIVE_WITH_EXTERNAL_FALLBACK" : "RUVANAS_LIVE"
          }
        }
      });

      return changedChannel;
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

