import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentDigitalSignageDevice } from "@/lib/digital-signage-device-auth";

export async function POST(request) {
  try {
    const device = await getCurrentDigitalSignageDevice();
    if (!device) return NextResponse.json({ error: "This display is not enrolled, disabled, or no longer entitled." }, { status: 401 });
    const now = new Date();
    const forwardedFor = request.headers.get("x-forwarded-for");
    await prisma.digitalSignageDevice.update({ where: { id: device.id }, data: {
      status: "ONLINE",
      lastHeartbeatAt: now,
      lastIpAddress: forwardedFor?.split(",")[0]?.trim() || null,
      lastUserAgent: request.headers.get("user-agent")?.slice(0, 500) || null
    } });
    return NextResponse.json({ ok: true, receivedAt: now.toISOString() });
  } catch (error) {
    console.error("Digital signage heartbeat error:", error);
    return NextResponse.json({ error: "Unable to record the display heartbeat." }, { status: 500 });
  }
}
