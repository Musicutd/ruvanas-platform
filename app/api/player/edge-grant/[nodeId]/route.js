import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/player-auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { issueCorrectionsEdgePlayerGrant } from "@/lib/corrections-edge-player-grant.mjs";
import { correctionsEdgeSigningPrivateKey } from "@/lib/corrections-edge-signing";
import { correctionsError } from "@/lib/corrections-http";
import { claimPlayerListenerLease, readPlayerInstanceId } from "@/lib/player-listener-lease.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const { nodeId } = await params;
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED" || !player.enrolledAt) {
      return NextResponse.json({ error: "Enrol this private player first." }, { status: 401 });
    }
    const listener = await claimPlayerListenerLease(prisma, { player, instanceId: readPlayerInstanceId(request) });
    if (!listener.ok) return NextResponse.json(listener, { status: listener.status });
    const rights = resolveEntitlements(player.organisation?.subscription);
    if (!rights.correctionsRadioEnabled || Number(rights.planTierNumber) < 4) {
      return NextResponse.json({ error: "Secure Edge requires Inside Tier 4 or 5." }, { status: 403 });
    }
    const now = new Date();
    const node = await prisma.correctionsEdgeNode.findFirst({ where: { id: nodeId, organisationId: player.organisationId,
      facilityId: player.zone.locationId, status: "ACTIVE", revokedAt: null } });
    if (!node?.playerEndpointOrigin) return NextResponse.json({ error: "No trusted Edge endpoint is bound to this facility." }, { status: 404 });
    const latest = await prisma.correctionsEdgeManifest.findFirst({ where: { nodeId: node.id,
      validFrom: { lte: now }, validUntil: { gt: now } }, orderBy: { sequence: "desc" } });
    const zone = latest?.payload?.zones?.find((item) => item.id === player.zoneId && item.playerIds.includes(player.id));
    if (!zone) return NextResponse.json({ error: "This player is not in the current Edge manifest." }, { status: 403 });
    const grant = issueCorrectionsEdgePlayerGrant({ nodeId: node.id, organisationId: node.organisationId,
      facilityId: node.facilityId, zoneId: player.zoneId, playerId: player.id,
      manifestVersion: latest.version }, correctionsEdgeSigningPrivateKey(),
      { now, validUntil: new Date(Math.min(latest.validUntil.getTime(), now.getTime() + 15 * 60_000)) });
    return NextResponse.json(grant, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return correctionsError(error); }
}
