import { NextResponse } from "next/server";
import { getCurrentDigitalSignageDevice } from "@/lib/digital-signage-device-auth";
import { SIGNAGE_HEARTBEAT_INTERVAL_SECONDS } from "@/lib/digital-signage-delivery.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const device = await getCurrentDigitalSignageDevice();
    if (!device) return NextResponse.json({ error: "This display is not enrolled, disabled, or no longer entitled." }, { status: 401 });
    return NextResponse.json({
      device: { id: device.id, name: device.name, location: device.zone.location.name, zone: device.zone.name, viewportWidth: device.viewportWidth, viewportHeight: device.viewportHeight, orientation: device.orientation },
      heartbeatIntervalSeconds: SIGNAGE_HEARTBEAT_INTERVAL_SECONDS,
      manifestUrl: "/api/signage/manifest"
    });
  } catch (error) {
    console.error("Digital signage state error:", error);
    return NextResponse.json({ error: "Unable to load display state." }, { status: 500 });
  }
}
