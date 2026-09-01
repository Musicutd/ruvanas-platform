import { resolveEntitlements } from "./entitlements.mjs";
import { ORGANISATION_MANAGER_ROLES } from "./permissions.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export function canManageSubscriberPlayers(role) {
  return ORGANISATION_MANAGER_ROLES.includes(role);
}

export function normalizeSubscriberPlayerInput(input = {}) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  const zoneId = typeof input.zoneId === "string" ? input.zoneId.trim() : "";
  if (name.length < 2) throw new Error("Add a player name with at least two characters.");
  if (!zoneId) throw new Error("Choose a location and zone for this player.");
  return { name, zoneId };
}

export function subscriberPlayerAllowance(subscription, instant = new Date()) {
  if (!subscription) return { enabled: true, limit: 1, legacy: true };
  const entitlements = resolveEntitlements(subscription, instant);
  return { enabled: entitlements.serviceEnabled, limit: entitlements.streamLimit, legacy: false };
}

export async function listSubscriberPlayers(database, { organisationId, instant = new Date() }) {
  return database.player.findMany({
    where: { organisationId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: {
      zone: {
        include: {
          location: { select: { id: true, name: true } },
          channelAssignments: {
            where: { activeFrom: { lte: instant }, OR: [{ activeTo: null }, { activeTo: { gt: instant } }] },
            orderBy: { activeFrom: "desc" },
            take: 1,
            include: { channel: { select: { id: true, name: true } } }
          }
        }
      },
      heartbeatSamples: {
        orderBy: { observedAt: "desc" },
        take: 1,
        select: { observedAt: true, appVersion: true, manifestVersion: true, sourceStatus: true }
      },
      proofOfPlayEvents: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { occurredAt: true, eventType: true, trackTitle: true, trackArtist: true, manifestVersion: true }
      },
      replacementPlayer: { select: { id: true, name: true, status: true } },
      replacesPlayer: { select: { id: true, name: true } }
    }
  });
}

export async function createSubscriberPlayer(database, {
  organisationId,
  actorUserId,
  input,
  enrolmentTokenHash,
  enrolmentExpiresAt,
  instant = new Date()
}) {
  let normalized;
  try {
    normalized = normalizeSubscriberPlayerInput(input);
  } catch (error) {
    return { ok: false, status: 400, error: error.message };
  }
  if (!enrolmentTokenHash || !(enrolmentExpiresAt instanceof Date) || enrolmentExpiresAt <= instant) {
    return { ok: false, status: 400, error: "Valid one-time enrolment credentials are required." };
  }

  return runSerializableTransaction(database, async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { organisationId },
      include: { plan: true, billingContract: true }
    });
    const allowance = subscriberPlayerAllowance(subscription, instant);
    if (!allowance.enabled || allowance.limit < 1) {
      return { ok: false, status: 403, error: "Shop-player setup is unavailable for this subscription." };
    }

    const zone = await tx.zone.findFirst({
      where: { id: normalized.zoneId, location: { organisationId } },
      select: { id: true, locationId: true }
    });
    if (!zone) return { ok: false, status: 400, error: "The selected zone is not part of this organisation." };

    const configured = await tx.player.count({
      where: { organisationId, status: { not: "DISABLED" } }
    });
    if (configured >= allowance.limit) {
      return {
        ok: false,
        status: 409,
        error: `This plan already has ${allowance.limit} configured shop player${allowance.limit === 1 ? "" : "s"}. Replace an existing player or increase the plan allowance.`,
        limit: allowance.limit,
        configured
      };
    }

    const player = await tx.player.create({
      data: {
        organisationId,
        zoneId: zone.id,
        name: normalized.name,
        enrolmentTokenHash,
        enrolmentExpiresAt
      }
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId,
        action: "SUBSCRIBER_PLAYER_CREATED",
        entityType: "Player",
        entityId: player.id,
        details: { name: player.name, zoneId: zone.id, locationId: zone.locationId, enrolmentExpiresAt }
      }
    });
    return { ok: true, status: 201, player, limit: allowance.limit, configured: configured + 1 };
  });
}
