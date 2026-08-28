import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { analyticsHourBucket } from "@/lib/operational-analytics.mjs";

export async function POST(request) {
  try {
    const player = await getCurrentPlayer();

    if (!player || player.status === "DISABLED") {
      return NextResponse.json(
        { error: "This player is not enrolled or has been disabled." },
        { status: 401 }
      );
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    const ipAddress = forwardedFor?.split(",")[0]?.trim() || null;
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
    const now = new Date();

    const bucketStart = analyticsHourBucket(now);
    await prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: player.id },
        data: {
          status: "ONLINE",
          lastHeartbeatAt: now,
          lastIpAddress: ipAddress,
          lastUserAgent: userAgent
        }
      });
      await tx.analyticsHourlyAggregate.upsert({
        where: {
          organisationId_playerId_bucketStart: {
            organisationId: player.organisationId,
            playerId: player.id,
            bucketStart
          }
        },
        create: {
          organisationId: player.organisationId,
          playerId: player.id,
          playerName: player.name,
          locationId: player.zone.location.id,
          locationName: player.zone.location.name,
          zoneId: player.zone.id,
          zoneName: player.zone.name,
          bucketStart,
          heartbeatCount: 1,
          firstHeartbeatAt: now,
          lastHeartbeatAt: now
        },
        update: {
          playerName: player.name,
          locationId: player.zone.location.id,
          locationName: player.zone.location.name,
          zoneId: player.zone.id,
          zoneName: player.zone.name,
          heartbeatCount: { increment: 1 },
          lastHeartbeatAt: now
        }
      });
      await tx.analyticsHourlyAggregate.updateMany({
        where: {
          organisationId: player.organisationId,
          playerId: player.id,
          bucketStart,
          firstHeartbeatAt: null
        },
        data: { firstHeartbeatAt: now }
      });
    });

    return NextResponse.json({ ok: true, receivedAt: now });
  } catch (error) {
    console.error("Player heartbeat error:", error);
    return NextResponse.json(
      { error: "Unable to record the player heartbeat." },
      { status: 500 }
    );
  }
}

