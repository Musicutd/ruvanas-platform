import { PLAYER_LISTENER_LEASE_SECONDS } from "./player-listener-lease.mjs";
import { ORGANISATION_MANAGER_ROLES } from "./permissions.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export function canManagePlayerSessions(role) {
  return ORGANISATION_MANAGER_ROLES.includes(role);
}

export async function listActivePlayerSessions(database, { organisationId, instant = new Date() }) {
  return database.playerListenerLease.findMany({
    where: {
      organisationId,
      revokedAt: null,
      expiresAt: { gt: instant }
    },
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      lastSeenAt: true,
      expiresAt: true,
      player: {
        select: {
          id: true,
          name: true,
          status: true,
          zone: {
            select: {
              id: true,
              name: true,
              location: { select: { id: true, name: true } }
            }
          }
        }
      }
    }
  });
}

export async function revokePlayerSession(database, {
  organisationId,
  leaseId,
  actorUserId,
  instant = new Date()
}) {
  const blockedUntil = new Date(instant.getTime() + PLAYER_LISTENER_LEASE_SECONDS * 1000);
  return runSerializableTransaction(database, async (tx) => {
    const lease = await tx.playerListenerLease.findFirst({
      where: { id: leaseId, organisationId, revokedAt: null, expiresAt: { gt: instant } },
      select: { id: true, playerId: true, lastSeenAt: true }
    });
    if (!lease) return { ok: false, status: 404, error: "That active player session is no longer available." };

    await tx.playerListenerLease.update({
      where: { id: lease.id },
      data: { revokedAt: instant, expiresAt: blockedUntil }
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId,
        action: "PLAYER_LISTENER_SESSION_REVOKED",
        entityType: "PlayerListenerLease",
        entityId: lease.id,
        details: { playerId: lease.playerId, lastSeenAt: lease.lastSeenAt, blockedUntil }
      }
    });
    return { ok: true, leaseId: lease.id, playerId: lease.playerId, blockedUntil };
  });
}
