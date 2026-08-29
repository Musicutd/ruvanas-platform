import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const { commandId } = await params;
    const command = await prisma.playerCommand.findUnique({ where: { id: String(commandId || "") } });
    if (!command) return NextResponse.json({ error: "Player command not found." }, { status: 404 });
    const changed = await prisma.$transaction(async (tx) => {
      const result = await tx.playerCommand.updateMany({
        where: { id: command.id, status: { in: ["PENDING", "DELIVERED"] } },
        data: { status: "CANCELLED" }
      });
      if (result.count !== 1) return null;
      await tx.auditLog.create({
        data: {
          organisationId: command.organisationId,
          actorUserId: access.user.id,
          action: "PLAYER_COMMAND_CANCELLED",
          entityType: "PlayerCommand",
          entityId: command.id,
          details: { playerId: command.playerId, kind: command.kind, requestId: getRequestId(request) }
        }
      });
      return tx.playerCommand.findUnique({ where: { id: command.id } });
    });
    if (!changed) return NextResponse.json({ error: "Only a pending or delivered command can be cancelled." }, { status: 409 });
    return NextResponse.json({ ok: true, command: changed });
  } catch (error) {
    console.error("Cancel player command error:", error);
    return NextResponse.json({ error: "Unable to cancel the player command." }, { status: 500 });
  }
}
