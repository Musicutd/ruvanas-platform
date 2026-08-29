import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getPlayerCommandOperations, expirePlayerCommands } from "@/lib/player-command-service";
import { normalizePlayerCommandKind, playerCommandExpiry } from "@/lib/player-commands.mjs";
import { getRequestId } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  playerId: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  ttlMinutes: z.number().int().min(5).max(60).optional()
});

export async function GET() {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    await expirePlayerCommands(prisma);
    return NextResponse.json(await getPlayerCommandOperations(prisma));
  } catch (error) {
    console.error("Load player commands error:", error);
    return NextResponse.json({ error: "Unable to load player command operations." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a player and an approved diagnostic command." }, { status: 400 });
    const kind = normalizePlayerCommandKind(parsed.data.kind);
    const player = await prisma.player.findUnique({ where: { id: parsed.data.playerId } });
    if (!player || player.status === "DISABLED" || !player.sessionTokenHash) {
      return NextResponse.json({ error: "Choose an enrolled, active player." }, { status: 400 });
    }
    await expirePlayerCommands(prisma);
    const duplicate = await prisma.playerCommand.findFirst({
      where: { playerId: player.id, kind, status: { in: ["PENDING", "DELIVERED"] } }
    });
    if (duplicate) return NextResponse.json({ error: "This diagnostic is already pending for the player." }, { status: 409 });
    const command = await prisma.$transaction(async (tx) => {
      const created = await tx.playerCommand.create({
        data: {
          organisationId: player.organisationId,
          playerId: player.id,
          kind,
          requestedById: access.user.id,
          expiresAt: playerCommandExpiry(new Date(), parsed.data.ttlMinutes)
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: player.organisationId,
          actorUserId: access.user.id,
          action: "PLAYER_COMMAND_REQUESTED",
          entityType: "PlayerCommand",
          entityId: created.id,
          details: { playerId: player.id, kind, expiresAt: created.expiresAt.toISOString(), requestId: getRequestId(request) }
        }
      });
      return created;
    });
    return NextResponse.json({ ok: true, command }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "This diagnostic is already pending for the player." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "Choose an approved player diagnostic command.") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Request player command error:", error);
    return NextResponse.json({ error: "Unable to request the player command." }, { status: 500 });
  }
}
