import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/player-auth";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { buildPlayerManifest } from "@/lib/player-manifest.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") {
      return NextResponse.json({ error: "This player is not enrolled or has been disabled." }, { status: 401 });
    }
    const instant = new Date();
    const { resolution } = await resolvePlayerProgramming(player, instant);
    const manifest = buildPlayerManifest({
      player,
      resolution,
      instant,
      proofSecret: process.env.SESSION_SECRET
    });
    return NextResponse.json(manifest, {
      headers: {
        "Cache-Control": "private, no-store",
        ETag: `"${manifest.version}"`
      }
    });
  } catch (error) {
    console.error("Player manifest error:", error);
    return NextResponse.json({ error: "Unable to prepare the player manifest." }, { status: 500 });
  }
}
