import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/player-auth";
import { acknowledgePlayerCommand } from "@/lib/player-command-service";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") {
      return NextResponse.json({ error: "This player is not enrolled or has been disabled." }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const { commandId } = await params;
    const result = await acknowledgePlayerCommand(prisma, {
      playerId: player.id,
      commandId: String(commandId || ""),
      acknowledgement: body
    });
    return NextResponse.json(result.ok ? { ok: true, command: result.command } : { error: result.error }, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to acknowledge the player command." }, { status: 400 });
  }
}
