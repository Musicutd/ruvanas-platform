import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentDigitalSignageDevice } from "@/lib/digital-signage-device-auth";
import { buildDigitalSignageManifest } from "@/lib/digital-signage-delivery.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const device = await getCurrentDigitalSignageDevice();
    if (!device) return NextResponse.json({ error: "This display is not enrolled, disabled, or no longer entitled." }, { status: 401 });
    const playlists = await prisma.digitalSignagePlaylist.findMany({
      where: { organisationId: device.organisationId, devices: { some: { deviceId: device.id } }, status: "PUBLISHED" },
      include: {
        layout: { include: { regions: { orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }] } } },
        items: { include: { asset: true }, orderBy: [{ regionId: "asc" }, { position: "asc" }] }
      }
    });
    const instant = new Date();
    const manifest = buildDigitalSignageManifest({ device, playlists, proofSecret: process.env.SESSION_SECRET, instant });
    await prisma.digitalSignageDevice.update({ where: { id: device.id }, data: { status: "ONLINE", lastHeartbeatAt: instant } });
    return NextResponse.json(manifest, { headers: { "Cache-Control": "private, no-store", ETag: `"${manifest.version}"` } });
  } catch (error) {
    console.error("Digital signage manifest error:", error);
    return NextResponse.json({ error: "Unable to prepare the display manifest." }, { status: 500 });
  }
}
