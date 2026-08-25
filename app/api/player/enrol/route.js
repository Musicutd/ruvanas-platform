import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { playerTokenHash, setPlayerCookie } from "@/lib/player-auth";

export async function POST(request) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!code) {
      return NextResponse.json(
        { error: "Enter the player enrolment code." },
        { status: 400 }
      );
    }

    const enrolmentTokenHash = playerTokenHash(code);
    const sessionToken = createPlayerToken();
    const now = new Date();

    const player = await prisma.$transaction(async (tx) => {
      const pending = await tx.player.findUnique({
        where: { enrolmentTokenHash }
      });

      if (
        !pending ||
        pending.status === "DISABLED" ||
        !pending.enrolmentExpiresAt ||
        pending.enrolmentExpiresAt <= now
      ) {
        return null;
      }

      const enrolled = await tx.player.update({
        where: { id: pending.id },
        data: {
          status: "ONLINE",
          enrolmentTokenHash: null,
          enrolmentExpiresAt: null,
          sessionTokenHash: playerTokenHash(sessionToken),
          enrolledAt: now,
          lastHeartbeatAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          organisationId: pending.organisationId,
          action: "PLAYER_ENROLLED",
          entityType: "Player",
          entityId: pending.id,
          details: { zoneId: pending.zoneId }
        }
      });

      return enrolled;
    });

    if (!player) {
      return NextResponse.json(
        { error: "This enrolment code is invalid, expired, or already used." },
        { status: 400 }
      );
    }

    setPlayerCookie(sessionToken);
    return NextResponse.json({ ok: true, playerId: player.id });
  } catch (error) {
    console.error("Player enrolment error:", error);
    return NextResponse.json(
      { error: "Unable to enrol this player." },
      { status: 500 }
    );
  }
}

