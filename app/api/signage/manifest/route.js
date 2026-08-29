import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentDigitalSignageDevice } from "@/lib/digital-signage-device-auth";
import { buildDigitalSignageManifest } from "@/lib/digital-signage-delivery.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const device = await getCurrentDigitalSignageDevice();
    if (!device) return NextResponse.json({ error: "This display is not enrolled, disabled, or no longer entitled." }, { status: 401 });
    const instant = new Date();
    const playlistInclude = {
      layout: { include: { regions: { orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }] } } },
      items: { include: { asset: true }, orderBy: [{ regionId: "asc" }, { position: "asc" }] }
    };
    const schoolNoticeboardsEnabled = resolveEntitlements(device.organisation.subscription).schoolRadioEnabled;
    const [playlists, takeovers, noticeboardPosts] = await Promise.all([
      prisma.digitalSignagePlaylist.findMany({
        where: { organisationId: device.organisationId, devices: { some: { deviceId: device.id } }, status: "PUBLISHED" },
        include: playlistInclude
      }),
      prisma.digitalSignageTakeover.findMany({
        where: { organisationId: device.organisationId, status: "ACTIVE", startsAt: { lte: instant }, endsAt: { gt: instant }, devices: { some: { deviceId: device.id } } },
        include: { playlist: { include: playlistInclude } },
        orderBy: { activatedAt: "desc" },
        take: 5
      }),
      schoolNoticeboardsEnabled ? prisma.schoolNoticeboardPost.findMany({
        where: {
          organisationId: device.organisationId,
          status: "SCHEDULED",
          startsAt: { lte: instant },
          endsAt: { gt: instant },
          OR: [
            { zoneId: device.zoneId },
            { locationId: device.zone.location.id, zoneId: null }
          ]
        },
        include: { announcement: { select: { id: true, title: true, summary: true, status: true } } },
        orderBy: [{ priority: "desc" }, { startsAt: "desc" }],
        take: 20
      }) : Promise.resolve([])
    ]);
    const manifest = buildDigitalSignageManifest({ device, playlists, takeovers, noticeboardPosts, proofSecret: process.env.SESSION_SECRET, instant });
    await prisma.digitalSignageDevice.update({ where: { id: device.id }, data: { status: "ONLINE", lastHeartbeatAt: instant } });
    return NextResponse.json(manifest, { headers: { "Cache-Control": "private, no-store", ETag: `"${manifest.version}"` } });
  } catch (error) {
    console.error("Digital signage manifest error:", error);
    return NextResponse.json({ error: "Unable to prepare the display manifest." }, { status: 500 });
  }
}
