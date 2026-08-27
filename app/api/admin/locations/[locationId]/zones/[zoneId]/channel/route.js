import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  isRetryableTransactionError,
  runSerializableTransaction
} from "@/lib/transaction-retry.mjs";

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

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

    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        organisationId: location.organisationId,
        status: { not: "ARCHIVED" }
      },
      select: {
        id: true,
        organisationId: true
      }
    });

    if (!channel) {
      return NextResponse.json(
        {
          error: "The selected channel is not available to this organisation."
        },
        {
          status: 400
        }
      );
    }

    const now = new Date();

    const assignment = await runSerializableTransaction(prisma, async (transaction) => {
      const previousAssignments = await transaction.channelAssignment.findMany({
        where: {
          zoneId,
          activeTo: null
        },
        select: {
          id: true,
          channelId: true
        }
      });

      const existingAssignment = await transaction.channelAssignment.findUnique({
        where: {
          channelId_zoneId: {
            channelId,
            zoneId
          }
        }
      });

      if (
        existingAssignment?.activeTo === null &&
        previousAssignments.length === 1
      ) {
        return transaction.channelAssignment.findUnique({
          where: { id: existingAssignment.id },
          include: {
            channel: {
              include: {
                station: {
                  include: { streamConfig: true }
                }
              }
            }
          }
        });
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

      const nextAssignment = existingAssignment
        ? await transaction.channelAssignment.update({
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
        })
        : await transaction.channelAssignment.create({
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

      await transaction.auditLog.create({
        data: {
          organisationId: location.organisationId,
          actorUserId: access.user.id,
          action: "ZONE_CHANNEL_ASSIGNED",
          entityType: "Zone",
          entityId: zoneId,
          details: {
            locationId,
            previousChannelIds: previousAssignments.map(
              (previousAssignment) => previousAssignment.channelId
            ),
            channelId,
            assignmentId: nextAssignment.id
          }
        }
      });

      return nextAssignment;
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

    if (isRetryableTransactionError(error)) {
      return NextResponse.json(
        { error: "Another channel update is in progress. Please try again." },
        { status: 409 }
      );
    }

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
