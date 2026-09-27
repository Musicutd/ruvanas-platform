import { localDateTimeParts } from "../lib/opening-hours.mjs";
import { chooseCorrectionsOverride } from "../lib/corrections-c6-policy.mjs";
import { rankCorrectionsNetworkWindows } from "../lib/corrections-network-policy.mjs";
import { edgeContentKey } from "./cache.mjs";

// Executes only a previously signed snapshot. This module cannot approve a
// programme or fetch an arbitrary asset. A missing/expired snapshot is silence.
export function resolveCorrectionsEdgePlayback(payload, { zoneId, playerId, instant = new Date(), unavailableContentKeys = new Set() } = {}) {
  const now = new Date(instant);
  if (!payload || Number.isNaN(now.getTime()) || now < new Date(payload.issuedAt) ||
      now >= new Date(payload.validUntil)) return { state: "EXPIRED_OR_UNAVAILABLE" };
  const zone = payload.zones.find((item) => item.id === zoneId && item.playerIds.includes(playerId));
  if (!zone) return { state: "PLAYER_NOT_AUTHORISED" };
  const available = new Map(payload.content.map((item) => [edgeContentKey(item), item]));
  const activeOverrides = payload.overrides.filter((item) => item.facilityId === payload.facilityId &&
    item.targetPlayerIds.includes(playerId)).map((item) => ({ ...item,
      status: "ACTIVE", startedAt: new Date(item.startedAt), expiresAt: new Date(item.expiresAt) }));
  const override = chooseCorrectionsOverride(activeOverrides, zoneId, now);
  if (override && unavailableContentKeys.has(override.contentKey)) return { state: "OVERRIDE_MEDIA_UNAVAILABLE" };
  if (override && available.has(override.contentKey)) return { state: "READY", source: `CORRECTIONS_${override.type}`,
    contentKey: override.contentKey, item: available.get(override.contentKey), overrideId: override.id };
  let local;
  try { local = localDateTimeParts(now, payload.timezone); }
  catch { return { state: "CLOCK_OR_TIMEZONE_INVALID" }; }
  for (const window of rankCorrectionsNetworkWindows(payload.windows, { facilityId: payload.facilityId,
    weekday: local.weekday, minute: local.minute })) {
    if (window.effectiveFrom && now < new Date(window.effectiveFrom)) continue;
    if (window.effectiveUntil && now >= new Date(window.effectiveUntil)) continue;
    const item = available.get(window.contentKey);
    if (!item || unavailableContentKeys.has(window.contentKey)) continue;
    return { state: "READY", source: window.programmingSource || (window.kind === "FALLBACK" ? "CORRECTIONS_FALLBACK" :
      window.kind === "LOCAL" ? "CORRECTIONS_LOCAL" : "CORRECTIONS_CENTRAL"),
      contentKey: window.contentKey, item, windowId: window.id, sourceRevision: window.sourceRevision };
  }
  return { state: "NO_APPROVED_SOURCE" };
}
