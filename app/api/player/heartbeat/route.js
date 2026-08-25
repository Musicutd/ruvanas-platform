import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";

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

    await prisma.player.update({
      where: { id: player.id },
      data: {
        status: "ONLINE",
        lastHeartbeatAt: now,
        lastIpAddress: ipAddress,
        lastUserAgent: userAgent
      }
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

