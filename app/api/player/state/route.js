import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/player-auth";
import { PLAYER_HEARTBEAT_INTERVAL_SECONDS } from "@/lib/player-tokens.mjs";
import { prisma } from "@/lib/prisma";
import { claimPlayerListenerLease, readPlayerInstanceId } from "@/lib/player-listener-lease.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const player = await getCurrentPlayer();

    if (!player || player.status === "DISABLED") {
      return NextResponse.json(
        { error: "This player is not enrolled or has been disabled." },
        { status: 401 }
      );
    }

    const listenerAccess = await claimPlayerListenerLease(prisma, {
      player,
      instanceId: readPlayerInstanceId(request)
    });
    if (!listenerAccess.ok) {
      return NextResponse.json(listenerAccess, {
        status: listenerAccess.status,
        headers: listenerAccess.retryAfterSeconds ? { "Retry-After": String(listenerAccess.retryAfterSeconds) } : undefined
      });
    }

    const assignment = player.zone.channelAssignments[0];
    const channel = assignment?.channel || null;

    return NextResponse.json({
      player: {
        id: player.id,
        name: player.name,
        zone: player.zone.name,
        location: player.zone.location.name
      },
      channel: channel
        ? {
            id: channel.id,
            name: channel.name,
            streamUrl: channel.station?.streamConfig?.streamUrl || null
          }
        : null,
      heartbeatIntervalSeconds: PLAYER_HEARTBEAT_INTERVAL_SECONDS,
      manifestUrl: "/api/player/manifest",
      listenerQuota: {
        active: listenerAccess.activeCount,
        limit: listenerAccess.limit
      }
    });
  } catch (error) {
    console.error("Player state error:", error);
    return NextResponse.json(
      { error: "Unable to load player state." },
      { status: 500 }
    );
  }
}

