import crypto from "node:crypto";
import { resolveEntitlements } from "./entitlements.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { normalizeListenerRequestSettings } from "./listener-interaction.mjs";

export const PUBLIC_LISTENER_SESSION_HEADER = "x-ruvanas-listener-session";
export const PUBLIC_LISTENER_LEASE_SECONDS = 90;
export const PUBLIC_PLAYBACK_TOKEN_SECONDS = 600;
export const PUBLIC_LISTENER_HEARTBEAT_SECONDS = 45;

const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

function signingSecret(secret = process.env.SESSION_SECRET) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return secret;
}

function signature(encoded, secret) {
  return crypto.createHmac("sha256", signingSecret(secret)).update(encoded).digest("base64url");
}

export function normalizePublicListenerSessionId(value) {
  const sessionId = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SESSION_PATTERN.test(sessionId) ? sessionId : null;
}

export function publicListenerSessionHash(sessionId, secret) {
  const normalized = normalizePublicListenerSessionId(sessionId);
  if (!normalized) throw new Error("A valid private listener session ID is required.");
  return crypto.createHmac("sha256", signingSecret(secret)).update(`public-listener:${normalized}`).digest("hex");
}

export function createPublicPlaybackToken({ organisationId, stationId, channelId, sessionHash, expiresAt, issuedAt = new Date() }, secret) {
  const issued = Math.floor(new Date(issuedAt).getTime() / 1000);
  const expiry = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (!organisationId || !stationId || !channelId || !HASH_PATTERN.test(sessionHash || "") || !Number.isSafeInteger(issued) || !Number.isSafeInteger(expiry) || expiry <= issued || expiry - issued > PUBLIC_PLAYBACK_TOKEN_SECONDS) {
    throw new Error("A valid, short-lived public playback authority is required.");
  }
  const encoded = Buffer.from(JSON.stringify({ v: 1, organisationId, stationId, channelId, sessionHash, iat: issued, exp: expiry })).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyPublicPlaybackToken(token, { instant = new Date(), secret } = {}) {
  const [encoded, supplied, ...extra] = typeof token === "string" ? token.split(".") : [];
  if (extra.length || !encoded || !supplied) return null;
  const expected = signature(encoded, secret);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const now = Math.floor(instant.getTime() / 1000);
    if (value.v !== 1 || !value.organisationId || !value.stationId || !value.channelId || !HASH_PATTERN.test(value.sessionHash || "")) return null;
    if (!Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp) || value.exp <= now || value.iat > now + 120 || value.exp <= value.iat || value.exp - value.iat > PUBLIC_PLAYBACK_TOKEN_SECONDS) return null;
    return value;
  } catch {
    return null;
  }
}

export function appendPublicPlaybackToken(url, token) {
  return `${url}${url.includes("?") ? "&" : "?"}listener=${encodeURIComponent(token)}`;
}

export function normalizePublicPlayerSettings(input = {}) {
  const tagline = typeof input.tagline === "string" ? input.tagline.trim() : "";
  const accent = typeof input.accent === "string" ? input.accent.trim().toLowerCase() : "#f4b942";
  if (tagline.length > 160) throw new Error("The public-player tagline must be 160 characters or fewer.");
  if (!ACCENT_PATTERN.test(accent)) throw new Error("Choose a six-digit public-player accent colour.");
  const enabled = input.enabled === true;
  const requests = normalizeListenerRequestSettings({ enabled: enabled && input.listenerRequestsEnabled, instructions: input.listenerRequestInstructions });
  return { enabled, tagline: tagline || null, accent, listenerRequestsEnabled: requests.enabled, listenerRequestInstructions: requests.instructions };
}

export async function claimPublicListenerLease(database, { station, channelId, sessionId, instant = new Date(), secret }) {
  const normalized = normalizePublicListenerSessionId(sessionId);
  if (!normalized) return { ok: false, status: 400, code: "PUBLIC_LISTENER_SESSION_REQUIRED", error: "Start a fresh private listener session before playback." };
  const entitlements = resolveEntitlements(station.organisation?.subscription, instant);
  const capability = station.productFamily === "HEALTH"
    ? "healthRadioEnabled"
    : station.productFamily === "FAITH"
      ? "faithRadioEnabled"
      : station.productFamily === "ORGANISATIONS"
        ? "organisationsEnabled"
        : "onlineRadioEnabled";
  const productEnabled = Boolean(entitlements[capability]);
  const audienceAllowed = !["HEALTH", "FAITH", "ORGANISATIONS"].includes(station.productFamily) || station.audiencePolicy === "PUBLIC";
  const limit = Math.min(Number(station.listenerLimit) || 0, Number(entitlements.listenerLimit) || 0);
  if (!station.publicPlayerEnabled || station.status !== "ACTIVE" || !entitlements.serviceEnabled || !productEnabled || !audienceAllowed || limit < 1) {
    return { ok: false, status: 403, code: "PUBLIC_PLAYER_UNAVAILABLE", error: "Public listening is not currently available for this station." };
  }
  const sessionHash = publicListenerSessionHash(normalized, secret);
  const expiresAt = new Date(instant.getTime() + PUBLIC_LISTENER_LEASE_SECONDS * 1_000);
  const result = await runSerializableTransaction(database, async (tx) => {
    await tx.publicListenerLease.deleteMany({ where: { stationId: station.id, expiresAt: { lte: instant } } });
    const existing = await tx.publicListenerLease.findUnique({ where: { stationId_sessionHash: { stationId: station.id, sessionHash } } });
    if (existing) {
      await tx.publicListenerLease.update({ where: { id: existing.id }, data: { channelId, lastSeenAt: instant, expiresAt } });
      const activeCount = await tx.publicListenerLease.count({ where: { stationId: station.id, expiresAt: { gt: instant } } });
      return { ok: true, activeCount: Math.min(activeCount, limit) };
    }
    const activeCount = await tx.publicListenerLease.count({ where: { stationId: station.id, expiresAt: { gt: instant } } });
    if (activeCount >= limit) return { ok: false, activeCount };
    await tx.publicListenerLease.create({ data: { organisationId: station.organisationId, stationId: station.id, channelId, sessionHash, lastSeenAt: instant, expiresAt } });
    return { ok: true, activeCount: activeCount + 1 };
  });
  if (!result.ok) return { ok: false, status: 429, code: "PUBLIC_LISTENER_LIMIT_REACHED", error: "This station has reached its current listener capacity. Please try again shortly.", limit, activeCount: result.activeCount, retryAfterSeconds: PUBLIC_LISTENER_LEASE_SECONDS };
  const tokenExpiresAt = new Date(instant.getTime() + PUBLIC_PLAYBACK_TOKEN_SECONDS * 1_000);
  return {
    ok: true,
    limit,
    activeCount: result.activeCount,
    sessionHash,
    expiresAt,
    playbackToken: createPublicPlaybackToken({ organisationId: station.organisationId, stationId: station.id, channelId, sessionHash, expiresAt: tokenExpiresAt, issuedAt: instant }, secret)
  };
}

export async function releasePublicListenerLease(database, { stationId, sessionId, secret }) {
  const normalized = normalizePublicListenerSessionId(sessionId);
  if (!normalized) return false;
  const sessionHash = publicListenerSessionHash(normalized, secret);
  const result = await database.publicListenerLease.deleteMany({ where: { stationId, sessionHash } });
  return result.count > 0;
}

export async function isPublicPlaybackTokenActive(database, { authority, instant = new Date() }) {
  if (!authority) return false;
  const lease = await database.publicListenerLease.findUnique({ where: { stationId_sessionHash: { stationId: authority.stationId, sessionHash: authority.sessionHash } } });
  return Boolean(lease && lease.organisationId === authority.organisationId && lease.channelId === authority.channelId && lease.expiresAt > instant);
}

export async function expirePublicListenerLeases(database, instant = new Date()) {
  const result = await database.publicListenerLease.deleteMany({ where: { expiresAt: { lte: instant } } });
  return { expired: result.count };
}

export function publicNowPlaying(manifest, instant = new Date()) {
  const insertion = (manifest.insertions || []).find((item) => {
    const start = new Date(item.plannedStart).getTime();
    return start <= instant.getTime() && start + item.durationSeconds * 1_000 > instant.getTime();
  });
  if (insertion) return { kind: insertion.itemType, title: insertion.title, artist: insertion.artist, startedAt: insertion.plannedStart };
  if (manifest.externalLive) return { kind: "LIVE", title: manifest.externalLive.sourceLabel, artist: "Live programme", startedAt: manifest.generatedAt };
  const item = manifest.playlist?.[manifest.live?.current?.index || 0];
  if (!item) return null;
  return { kind: "MUSIC", title: item.title, artist: item.artist, startedAt: manifest.live?.current?.startedAt || manifest.generatedAt };
}
