import crypto from "node:crypto";
import { localDateTimeParts, parseLocalTime } from "./opening-hours.mjs";
import { compileSchoolNoticeboard } from "./school-noticeboard.mjs";

export const SIGNAGE_MANIFEST_TTL_SECONDS = 300;
export const SIGNAGE_MANIFEST_REFRESH_SECONDS = 60;
export const SIGNAGE_OFFLINE_GRACE_SECONDS = 24 * 60 * 60;
export const SIGNAGE_HEARTBEAT_INTERVAL_SECONDS = 60;
export const MAX_OFFLINE_SIGNAGE_EVENTS = 500;

const clean = (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "";

function integer(value, label, { min, max }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}

function optionalInstant(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return parsed;
}

function minute(value, label, fallback, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "string" && value.includes(":") ? parseLocalTime(value) : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) throw new Error(`${label} is invalid.`);
  return parsed;
}

export function normaliseDigitalSignagePlaylist(input = {}) {
  const organisationId = clean(input.organisationId, 100);
  const layoutId = clean(input.layoutId, 100);
  const name = clean(input.name, 200);
  const startsAt = optionalInstant(input.startsAt, "Start time");
  const endsAt = optionalInstant(input.endsAt, "End time");
  const activeDays = [...new Set((Array.isArray(input.activeDays) && input.activeDays.length ? input.activeDays : [0, 1, 2, 3, 4, 5, 6]).map((value) => integer(value, "Active day", { min: 0, max: 6 })))].sort((left, right) => left - right);
  const dailyStartMinute = minute(input.dailyStartMinute ?? input.dailyStart, "Daily start", 0, 1439);
  const dailyEndMinute = minute(input.dailyEndMinute ?? input.dailyEnd, "Daily end", 1440, 1440);
  const priority = integer(input.priority ?? 0, "Priority", { min: 0, max: 100 });
  const deviceIds = [...new Set((Array.isArray(input.deviceIds) ? input.deviceIds : []).map((value) => clean(value, 100)).filter(Boolean))];

  if (!organisationId || !layoutId || !name) throw new Error("Organisation, layout, and playlist name are required.");
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error("The playlist end must be after its start.");
  if (dailyStartMinute === dailyEndMinute) throw new Error("Daily start and end times must be different.");
  if (!deviceIds.length) throw new Error("Assign the playlist to at least one display device.");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 250) throw new Error("A playlist needs between 1 and 250 visual items.");

  const occupied = new Set();
  const positions = new Map();
  const items = input.items.map((entry) => {
    const regionId = clean(entry?.regionId, 100);
    const assetId = clean(entry?.assetId, 100);
    if (!regionId || !assetId) throw new Error("Every playlist item needs a layout region and visual asset.");
    const position = entry?.position === undefined
      ? (positions.get(regionId) || 0)
      : integer(entry.position, "Item position", { min: 0, max: 249 });
    positions.set(regionId, Math.max(positions.get(regionId) || 0, position + 1));
    const key = `${regionId}:${position}`;
    if (occupied.has(key)) throw new Error("A layout region cannot contain two items in the same position.");
    occupied.add(key);
    return {
      regionId,
      assetId,
      position,
      durationSeconds: integer(entry?.durationSeconds ?? 10, "Display duration", { min: 3, max: 86400 })
    };
  });

  return { organisationId, layoutId, name, startsAt, endsAt, activeDays, dailyStartMinute, dailyEndMinute, priority, deviceIds, items };
}

function activeDailyWindow(playlist, local) {
  const days = playlist.activeDays?.length ? playlist.activeDays : [0, 1, 2, 3, 4, 5, 6];
  const start = playlist.dailyStartMinute;
  const end = playlist.dailyEndMinute;
  if (start < end) return days.includes(local.weekday) && local.minute >= start && local.minute < end;
  if (local.minute >= start) return days.includes(local.weekday);
  return local.minute < end && days.includes((local.weekday + 6) % 7);
}

export function isDigitalSignagePlaylistActive(playlist, instant = new Date(), timezone = "UTC") {
  if (!playlist || playlist.status !== "PUBLISHED") return false;
  if (playlist.startsAt && new Date(playlist.startsAt) > instant) return false;
  if (playlist.endsAt && new Date(playlist.endsAt) <= instant) return false;
  return activeDailyWindow(playlist, localDateTimeParts(instant, timezone));
}

export function selectDigitalSignagePlaylist(playlists = [], instant = new Date(), timezone = "UTC") {
  return playlists
    .filter((playlist) => isDigitalSignagePlaylistActive(playlist, instant, timezone))
    .sort((left, right) => right.priority - left.priority || right.version - left.version || left.id.localeCompare(right.id))[0] || null;
}

export function normaliseDigitalSignageTakeover(input = {}, instant = new Date()) {
  const organisationId = clean(input.organisationId, 100);
  const playlistId = clean(input.playlistId, 100);
  const name = clean(input.name, 200);
  const reason = clean(input.reason, 1000);
  const startsAt = optionalInstant(input.startsAt, "Takeover start") || instant;
  const endsAt = optionalInstant(input.endsAt, "Takeover end");
  const deviceIds = [...new Set((Array.isArray(input.deviceIds) ? input.deviceIds : []).map((value) => clean(value, 100)).filter(Boolean))];
  if (!organisationId || !playlistId || !name || !reason) throw new Error("Organisation, playlist, name, and operational reason are required.");
  if (!endsAt || endsAt <= startsAt) throw new Error("The takeover end must be after its start.");
  if (endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60 * 1000) throw new Error("A takeover may remain active for no more than 24 hours.");
  if (!deviceIds.length || deviceIds.length > 500) throw new Error("Assign between 1 and 500 display devices.");
  return { organisationId, playlistId, name, reason, startsAt, endsAt, deviceIds };
}

export function selectDigitalSignageTakeover(takeovers = [], instant = new Date()) {
  return takeovers
    .filter((takeover) => takeover?.status === "ACTIVE" && new Date(takeover.startsAt) <= instant && new Date(takeover.endsAt) > instant && takeover.playlist?.status === "PUBLISHED")
    .sort((left, right) => new Date(right.activatedAt || right.createdAt) - new Date(left.activatedAt || left.createdAt) || left.id.localeCompare(right.id))[0] || null;
}

function proofPayload({ deviceId, manifestVersion, playlistItemId, assetId, takeoverId, retailMediaOrderId }) {
  const base = `${deviceId}:${manifestVersion}:${playlistItemId}:${assetId}`;
  return takeoverId || retailMediaOrderId ? `${base}:${takeoverId || "-"}:${retailMediaOrderId || "-"}` : base;
}

function validateSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("A signage proof secret of at least 32 characters is required.");
}

export function createDigitalSignageProofToken(input, secret) {
  validateSecret(secret);
  return crypto.createHmac("sha256", secret).update(proofPayload(input)).digest("hex");
}

export function verifyDigitalSignageProofToken(input, token, secret) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = createDigitalSignageProofToken(input, secret);
  return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
}

export function buildDigitalSignageManifest({ device, playlists = [], takeovers = [], noticeboardPosts = [], proofSecret, instant = new Date() }) {
  const bucketMs = SIGNAGE_MANIFEST_TTL_SECONDS * 1000;
  const bucketStart = Math.floor(instant.getTime() / bucketMs) * bucketMs;
  const expiresAt = new Date(bucketStart + bucketMs);
  const takeover = selectDigitalSignageTakeover(takeovers, instant);
  const plannedOfflineGrace = new Date(bucketStart + SIGNAGE_OFFLINE_GRACE_SECONDS * 1000);
  const takeoverOfflineLimit = new Date(Math.min(expiresAt.getTime(), new Date(takeover?.endsAt || expiresAt).getTime()));
  const offlineGraceUntil = takeover ? takeoverOfflineLimit : plannedOfflineGrace;
  const timezone = device.zone.location.timezone;
  const playlist = takeover?.playlist || selectDigitalSignagePlaylist(playlists, instant, timezone);
  const noticeboardItems = takeover ? [] : compileSchoolNoticeboard({ posts: noticeboardPosts, device, instant });
  const noticeboardSignature = noticeboardItems.map((item) => `${item.id}:${item.priority}:${item.startsAt}:${item.endsAt}`).join("|");
  const signatureInput = playlist
    ? [device.id, takeover?.id || "scheduled", playlist.id, playlist.version, bucketStart, noticeboardSignature, ...playlist.items.map((item) => `${item.id}:${item.assetId}:${item.asset.checksumSha256}:${item.durationSeconds}`)].join("|")
    : `${device.id}:empty:${bucketStart}:${noticeboardSignature}`;
  const version = crypto.createHash("sha256").update(signatureInput).digest("hex").slice(0, 24);

  const base = {
    version,
    generatedAt: instant.toISOString(),
    expiresAt: expiresAt.toISOString(),
    offlineGraceUntil: offlineGraceUntil.toISOString(),
    refreshAfterSeconds: takeover ? 30 : SIGNAGE_MANIFEST_REFRESH_SECONDS,
    device: { id: device.id, name: device.name, location: device.zone.location.name, zone: device.zone.name, timezone, viewportWidth: device.viewportWidth, viewportHeight: device.viewportHeight, orientation: device.orientation },
    noticeboard: { policyVersion: "school-noticeboard-v1", items: noticeboardItems }
  };
  if (!playlist) return { ...base, state: noticeboardItems.length ? "NOTICEBOARD_ONLY" : "NO_ACTIVE_PLAYLIST", deliveryClass: noticeboardItems.length ? "SCHOOL_NOTICEBOARD" : null, playlist: null };

  const regions = playlist.layout.regions.map((region) => ({
    id: region.id,
    name: region.name,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    zIndex: region.zIndex,
    fitMode: region.fitMode,
    items: playlist.items.filter((item) => item.regionId === region.id).sort((left, right) => left.position - right.position).map((item) => ({
      id: item.id,
      position: item.position,
      durationSeconds: item.durationSeconds,
      asset: { id: item.asset.id, name: item.asset.name, kind: item.asset.kind, mimeType: item.asset.mimeType, width: item.asset.width, height: item.asset.height, durationSeconds: item.asset.durationSeconds, checksumSha256: item.asset.checksumSha256, mediaUrl: `/api/signage/media/${item.asset.id}` },
      proofToken: createDigitalSignageProofToken({ deviceId: device.id, manifestVersion: version, playlistItemId: item.id, assetId: item.asset.id, takeoverId: takeover?.id, retailMediaOrderId: playlist.retailMediaOrderId }, proofSecret)
    }))
  }));

  return {
    ...base,
    deliveryClass: takeover ? "EMERGENCY_TAKEOVER" : playlist.retailMediaOrderId ? "RETAIL_MEDIA" : "SCHEDULED",
    takeover: takeover ? { id: takeover.id, name: takeover.name, reason: takeover.reason, endsAt: new Date(takeover.endsAt).toISOString(), safetyNotice: "This visual takeover supplements operational communication and is not a certified life-safety alarm system." } : null,
    state: regions.some((region) => region.items.length) ? "READY" : "NO_PLAYABLE_ITEMS",
    playlist: {
      id: playlist.id,
      name: playlist.name,
      version: playlist.version,
      priority: playlist.priority,
      retailMediaOrderId: playlist.retailMediaOrderId || null,
      layout: { id: playlist.layout.id, name: playlist.layout.name, canvasWidth: playlist.layout.canvasWidth, canvasHeight: playlist.layout.canvasHeight, backgroundColor: playlist.layout.backgroundColor, orientation: playlist.layout.orientation, regions }
    }
  };
}

export function appendDigitalSignageEvent(queue, event, maximum = MAX_OFFLINE_SIGNAGE_EVENTS) {
  const withoutDuplicate = queue.filter((item) => item.eventId !== event.eventId);
  return [...withoutDuplicate, event].slice(-maximum);
}

export function removeDigitalSignageEvents(queue, eventIds) {
  const sent = new Set(eventIds);
  return queue.filter((event) => !sent.has(event.eventId));
}
