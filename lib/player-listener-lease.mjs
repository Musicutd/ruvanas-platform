import crypto from "node:crypto";
import { resolveEntitlements } from "./entitlements.mjs";
import { hashPlayerToken } from "./player-tokens.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export const PLAYER_INSTANCE_HEADER = "x-ruvanas-player-instance";
export const PLAYER_LISTENER_LEASE_SECONDS = 90;
export const PLAYER_LISTENER_TOKEN_SECONDS = 600;

const INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function signingSecret(secret = process.env.SESSION_SECRET) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

export function normalizePlayerInstanceId(value) {
  const instanceId = typeof value === "string" ? value.trim().toLowerCase() : "";
  return INSTANCE_PATTERN.test(instanceId) ? instanceId : null;
}

export function readPlayerInstanceId(request) {
  return normalizePlayerInstanceId(request.headers.get(PLAYER_INSTANCE_HEADER));
}

export function playerInstanceHash(instanceId, secret) {
  const normalized = normalizePlayerInstanceId(instanceId);
  if (!normalized) throw new Error("A valid player instance ID is required.");
  return hashPlayerToken(normalized, signingSecret(secret));
}

function listenerTokenPayload({ playerId, expiresAtSeconds, instanceHash }) {
  return `${playerId}:${expiresAtSeconds}:${instanceHash}`;
}

export function createPlayerListenerToken({ playerId, instanceHash, expiresAt }, secret) {
  if (!HASH_PATTERN.test(instanceHash || "")) throw new Error("A valid player instance hash is required.");
  const expiresAtSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (!Number.isSafeInteger(expiresAtSeconds)) throw new Error("A valid listener-token expiry is required.");
  const signature = crypto
    .createHmac("sha256", signingSecret(secret))
    .update(listenerTokenPayload({ playerId, expiresAtSeconds, instanceHash }))
    .digest("hex");
  return `${expiresAtSeconds}.${instanceHash}.${signature}`;
}

export function verifyPlayerListenerToken({ playerId, token, instant = new Date() }, secret) {
  const [expiresValue, instanceHash, signature, ...extra] = typeof token === "string" ? token.split(".") : [];
  const expiresAtSeconds = Number(expiresValue);
  if (extra.length || !Number.isSafeInteger(expiresAtSeconds) || !HASH_PATTERN.test(instanceHash || "") || !HASH_PATTERN.test(signature || "")) {
    return null;
  }
  if (expiresAtSeconds <= Math.floor(instant.getTime() / 1000)) return null;
  const expected = crypto
    .createHmac("sha256", signingSecret(secret))
    .update(listenerTokenPayload({ playerId, expiresAtSeconds, instanceHash }))
    .digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return null;
  return { instanceHash, expiresAt: new Date(expiresAtSeconds * 1000) };
}

export function appendPlayerListenerToken(mediaUrl, listenerToken) {
  if (!listenerToken) return mediaUrl;
  return `${mediaUrl}${mediaUrl.includes("?") ? "&" : "?"}listener=${encodeURIComponent(listenerToken)}`;
}

export async function claimPlayerListenerLease(database, {
  player,
  instanceId,
  instant = new Date(),
  secret
}) {
  const normalizedInstanceId = normalizePlayerInstanceId(instanceId);
  if (!normalizedInstanceId) {
    return { ok: false, status: 400, code: "PLAYER_INSTANCE_REQUIRED", error: "This player needs a valid browser instance before playback can start." };
  }

  const subscription = player.organisation?.subscription;
  const entitlements = resolveEntitlements(subscription, instant);
  // Older Super Admin-created organisations can pre-date subscription rows.
  // Preserve one controlled test slot until a commercial plan is attached.
  const limit = subscription ? entitlements.streamLimit : 1;
  if ((subscription && !entitlements.serviceEnabled) || limit < 1) {
    return { ok: false, status: 403, code: "PLAYER_SERVICE_UNAVAILABLE", error: "Player streaming is unavailable for this subscription." };
  }

  const instanceHash = playerInstanceHash(normalizedInstanceId, secret);
  const expiresAt = new Date(instant.getTime() + PLAYER_LISTENER_LEASE_SECONDS * 1000);
  const result = await runSerializableTransaction(database, async (tx) => {
    await tx.playerListenerLease.deleteMany({
      where: { organisationId: player.organisationId, expiresAt: { lte: instant } }
    });
    const active = await tx.playerListenerLease.findMany({
      where: { organisationId: player.organisationId, expiresAt: { gt: instant } },
      select: { id: true, playerId: true, instanceHash: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const existingIndex = active.findIndex((lease) => lease.playerId === player.id && lease.instanceHash === instanceHash);

    if (existingIndex >= 0) {
      if (existingIndex >= limit) {
        await tx.playerListenerLease.delete({ where: { id: active[existingIndex].id } });
        return { ok: false, activeCount: Math.min(active.length - 1, limit) };
      }
      await tx.playerListenerLease.update({
        where: { id: active[existingIndex].id },
        data: { lastSeenAt: instant, expiresAt }
      });
      return { ok: true, activeCount: Math.min(active.length, limit) };
    }

    if (active.length >= limit) return { ok: false, activeCount: active.length };
    await tx.playerListenerLease.create({
      data: { organisationId: player.organisationId, playerId: player.id, instanceHash, lastSeenAt: instant, expiresAt }
    });
    return { ok: true, activeCount: active.length + 1 };
  });

  if (!result.ok) {
    return {
      ok: false,
      status: 429,
      code: "PLAYER_STREAM_LIMIT_REACHED",
      error: `This subscription already has ${limit} active player stream${limit === 1 ? "" : "s"}. Close another player before starting this one.`,
      limit,
      activeCount: result.activeCount,
      retryAfterSeconds: PLAYER_LISTENER_LEASE_SECONDS
    };
  }

  const tokenExpiresAt = new Date(instant.getTime() + PLAYER_LISTENER_TOKEN_SECONDS * 1000);
  return {
    ok: true,
    limit,
    activeCount: result.activeCount,
    expiresAt,
    listenerToken: createPlayerListenerToken({ playerId: player.id, instanceHash, expiresAt: tokenExpiresAt }, secret)
  };
}

export async function releasePlayerListenerLease(database, { player, instanceId, secret }) {
  const normalizedInstanceId = normalizePlayerInstanceId(instanceId);
  if (!normalizedInstanceId) return false;
  const instanceHash = playerInstanceHash(normalizedInstanceId, secret);
  const deleted = await database.playerListenerLease.deleteMany({
    where: { playerId: player.id, organisationId: player.organisationId, instanceHash }
  });
  return deleted.count > 0;
}

export async function isPlayerListenerTokenActive(database, { player, token, instant = new Date(), secret }) {
  const verified = verifyPlayerListenerToken({ playerId: player.id, token, instant }, secret);
  if (!verified) return false;
  const lease = await database.playerListenerLease.findUnique({
    where: { playerId_instanceHash: { playerId: player.id, instanceHash: verified.instanceHash } },
    select: { expiresAt: true }
  });
  return Boolean(lease && lease.expiresAt > instant);
}
