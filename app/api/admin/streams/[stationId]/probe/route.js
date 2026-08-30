import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { probeStationStream } from "@/lib/stream-source-health-service";
import { getRequestId } from "@/lib/security-log";

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const { stationId } = await params;
    const config = await prisma.stationStreamConfig.findUnique({
      where: { stationId: String(stationId || "") },
      include: { station: { select: { id: true, organisationId: true, name: true } } }
    });
    if (!config?.streamUrl) return NextResponse.json({ error: "This station does not have a public stream configured." }, { status: 404 });
    const result = await probeStationStream(prisma, config);
    await prisma.auditLog.create({
      data: {
        organisationId: config.station.organisationId,
        actorUserId: access.user.id,
        action: "STATION_STREAM_PROBE_REQUESTED",
        entityType: "Station",
        entityId: config.station.id,
        details: { status: result.status, consecutiveFailures: result.consecutiveFailures, requestId: getRequestId(request) }
      }
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Manual stream probe error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to probe the stream source." }, { status: 400 });
  }
}
