import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/player-auth";
import { PLAYER_HEARTBEAT_INTERVAL_SECONDS } from "@/lib/player-tokens.mjs";
import { prisma } from "@/lib/prisma";
import { claimPlayerListenerLease, readPlayerInstanceId } from "@/lib/player-listener-lease.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

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
    const privateFacility = await prisma.correctionsFacility.findFirst({ where: { locationId: player.zone.locationId, location: { organisationId: player.organisationId } }, select: { locationId: true } });
    const edgeRights = resolveEntitlements(player.organisation?.subscription);
    const edgeNode = privateFacility && edgeRights.correctionsRadioEnabled && Number(edgeRights.planTierNumber) >= 4 ? await prisma.correctionsEdgeNode.findFirst({ where: {
      organisationId: player.organisationId, facilityId: player.zone.locationId, status: "ACTIVE",
      revokedAt: null, playerEndpointOrigin: { not: null }
    }, select: { id: true, organisationId: true, facilityId: true, playerEndpointOrigin: true,
      proofPublicKeyPem: true, manifests: { where: { validFrom: { lte: new Date() }, validUntil: { gt: new Date() } },
        orderBy: { sequence: "desc" }, take: 1, select: { version: true, payload: true, validUntil: true } } } }) : null;
    const edgeManifest = edgeNode?.manifests[0];
    const edgeZone = edgeManifest?.payload?.zones?.find((item) => item.id === player.zoneId &&
      item.playerIds.includes(player.id));

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
            streamUrl: privateFacility ? null : channel.station?.streamConfig?.streamUrl || null
          }
        : null,
      heartbeatIntervalSeconds: PLAYER_HEARTBEAT_INTERVAL_SECONDS,
      secureEdge: edgeZone && edgeNode.proofPublicKeyPem ? { nodeId: edgeNode.id,
        organisationId: edgeNode.organisationId, facilityId: edgeNode.facilityId,
        zoneId: player.zoneId, playerId: player.id, manifestVersion: edgeManifest.version,
        validUntil: edgeManifest.validUntil.toISOString(), endpointOrigin: edgeNode.playerEndpointOrigin,
        identityPublicKeyPem: edgeNode.proofPublicKeyPem } : null,
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

