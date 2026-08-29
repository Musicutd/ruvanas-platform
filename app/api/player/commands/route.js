import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/player-auth";
import { deliverNextPlayerCommand } from "@/lib/player-command-service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") {
      return NextResponse.json({ error: "This player is not enrolled or has been disabled." }, { status: 401 });
    }
    const command = await deliverNextPlayerCommand(prisma, player.id);
    return NextResponse.json({ command });
  } catch (error) {
    console.error("Player command delivery error:", error);
    return NextResponse.json({ error: "Unable to load player commands." }, { status: 500 });
  }
}
