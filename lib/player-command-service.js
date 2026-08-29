import {
  canAcknowledgePlayerCommand,
  normalizePlayerCommandAcknowledgement,
  replacementPlayerName
} from "./player-commands.mjs";

const ACTIVE_COMMAND_STATUSES = ["PENDING", "DELIVERED"];

export async function expirePlayerCommands(prismaClient, { now = new Date(), playerId = null } = {}) {
  const result = await prismaClient.playerCommand.updateMany({
    where: { status: { in: ACTIVE_COMMAND_STATUSES }, expiresAt: { lte: now }, ...(playerId ? { playerId } : {}) },
    data: { status: "EXPIRED" }
  });
  return { expired: result.count };
}

export async function deliverNextPlayerCommand(prismaClient, playerId, { now = new Date() } = {}) {
  await expirePlayerCommands(prismaClient, { now, playerId });
  return prismaClient.$transaction(async (tx) => {
    const command = await tx.playerCommand.findFirst({
      where: { playerId, status: "PENDING", expiresAt: { gt: now } },
      orderBy: { requestedAt: "asc" }
    });
    if (!command) return null;
    const claimed = await tx.playerCommand.updateMany({
      where: { id: command.id, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "DELIVERED", deliveredAt: now }
    });
    if (claimed.count !== 1) return null;
    await tx.auditLog.create({
      data: {
        organisationId: command.organisationId,
        action: "PLAYER_COMMAND_DELIVERED",
        entityType: "PlayerCommand",
        entityId: command.id,
        details: { playerId, kind: command.kind }
      }
    });
    return { id: command.id, kind: command.kind, expiresAt: command.expiresAt };
  });
}

export async function acknowledgePlayerCommand(prismaClient, { playerId, commandId, acknowledgement, now = new Date() }) {
  const command = await prismaClient.playerCommand.findFirst({ where: { id: commandId, playerId } });
  if (!command) return { ok: false, status: 404, error: "Player command not found." };
  const allowed = canAcknowledgePlayerCommand(command, now);
  if (!allowed.ok) {
    if (allowed.reason === "EXPIRED") {
      await prismaClient.playerCommand.updateMany({ where: { id: command.id, status: "DELIVERED" }, data: { status: "EXPIRED" } });
      return { ok: false, status: 410, error: "This player command has expired." };
    }
    return { ok: false, status: 409, error: "This player command cannot be acknowledged again." };
  }
  const normalized = normalizePlayerCommandAcknowledgement(acknowledgement);
  const changed = await prismaClient.$transaction(async (tx) => {
    const updated = await tx.playerCommand.updateMany({
      where: { id: command.id, playerId, status: "DELIVERED", expiresAt: { gt: now } },
      data: { ...normalized, acknowledgedAt: now }
    });
    if (updated.count !== 1) return null;
    await tx.auditLog.create({
      data: {
        organisationId: command.organisationId,
        action: "PLAYER_COMMAND_ACKNOWLEDGED",
        entityType: "PlayerCommand",
        entityId: command.id,
        details: { playerId, kind: command.kind, resultCode: normalized.resultCode }
      }
    });
    return tx.playerCommand.findUnique({ where: { id: command.id } });
  });
  return changed ? { ok: true, status: 200, command: changed } : { ok: false, status: 409, error: "This player command changed before acknowledgement." };
}

export async function getPlayerCommandOperations(prismaClient) {
  const [players, commands] = await Promise.all([
    prismaClient.player.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        organisation: { select: { id: true, name: true } },
        zone: { include: { location: { select: { id: true, name: true } } } },
        replacementPlayer: { select: { id: true, name: true, status: true } },
        replacesPlayer: { select: { id: true, name: true } }
      }
    }),
    prismaClient.playerCommand.findMany({
      orderBy: { requestedAt: "desc" },
      take: 100,
      include: {
        player: { select: { id: true, name: true } },
        organisation: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, email: true } }
      }
    })
  ]);
  return { players, commands };
}

export async function transitionPlayerLifecycle(prismaClient, {
  playerId,
  action,
  note,
  replacementName,
  actorUserId,
  enrolmentTokenHash = null,
  enrolmentExpiresAt = null,
  requestId = null,
  now = new Date()
}) {
  const current = await prismaClient.player.findUnique({ where: { id: playerId }, include: { replacementPlayer: true } });
  if (!current) throw new Error("Player not found.");
  if (current.status === "DISABLED") throw new Error("This player has already been disabled.");
  if (action === "CREATE_REPLACEMENT" && current.replacementPlayer) throw new Error("A replacement already exists for this player.");
  if (action === "CREATE_REPLACEMENT" && (!enrolmentTokenHash || !enrolmentExpiresAt)) throw new Error("Replacement enrolment credentials are required.");
  return prismaClient.$transaction(async (tx) => {
    const disabled = await tx.player.updateMany({
      where: { id: current.id, status: { not: "DISABLED" } },
      data: {
        status: "DISABLED",
        sessionTokenHash: null,
        enrolmentTokenHash: null,
        enrolmentExpiresAt: null,
        sessionRevokedAt: now,
        retiredAt: now,
        retiredReason: note
      }
    });
    if (disabled.count !== 1) throw new Error("The player changed while this action was being completed.");
    await tx.playerCommand.updateMany({ where: { playerId: current.id, status: { in: ACTIVE_COMMAND_STATUSES } }, data: { status: "CANCELLED" } });
    let replacement = null;
    if (action === "CREATE_REPLACEMENT") {
      replacement = await tx.player.create({
        data: {
          organisationId: current.organisationId,
          zoneId: current.zoneId,
          name: replacementPlayerName(current.name, replacementName),
          enrolmentTokenHash,
          enrolmentExpiresAt,
          replacesPlayerId: current.id
        }
      });
    }
    await tx.auditLog.create({
      data: {
        organisationId: current.organisationId,
        actorUserId,
        action: replacement ? "PLAYER_REPLACEMENT_CREATED" : "PLAYER_SESSION_REVOKED",
        entityType: "Player",
        entityId: current.id,
        details: { replacementPlayerId: replacement?.id || null, reason: note, requestId }
      }
    });
    return { currentPlayerId: current.id, replacement };
  });
}
