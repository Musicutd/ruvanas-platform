import { musicTrackEligibility } from "./media-library-pro.mjs";

export const STUDIO_PLAYOUT_MODES = Object.freeze(["AUTO", "ASSIST", "MANUAL"]);
export const STUDIO_PROGRAMME_ROLES = Object.freeze(["INTRO", "OUTRO", "JINGLE", "BED", "PROMO", "PRERECORDED_SEGMENT", "INTERVIEW", "RECURRING_FEATURE"]);
export const LOW_QUEUE_THRESHOLD = 2;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export function playoutModeTransition(session, nextMode, { hasFallback = false } = {}) {
  if (!STUDIO_PLAYOUT_MODES.includes(nextMode)) throw new Error("Choose Auto, Assist, or Manual mode.");
  if (!["ACTIVE", "FALLBACK"].includes(session.status)) throw new Error("This playout session is no longer active.");
  if (nextMode === "MANUAL" && !hasFallback) throw new Error("Manual mode requires an active AutoDJ or scheduled fallback.");
  return { mode: nextMode, status: "ACTIVE", outputHealth: nextMode === "AUTO" ? "AUTODJ_ACTIVE" : "FALLBACK_ARMED" };
}

const PRODUCT_MUSIC_USE = Object.freeze({
  RETAIL: "RETAIL_RADIO", SCHOOL: "SCHOOL_RADIO", ONLINE: "ONLINE_RADIO",
  HEALTH: "HEALTH_RADIO", FAITH: "FAITH_RADIO", ORGANISATIONS: "ORGANISATIONS_RADIO"
});

export function studioQueueReadiness(asset, {
  organisationId, productFamily, rightsUse = null, territory = null,
  licensedMusicCatalogueLevel = null, configuredGenres = [], instant = new Date()
} = {}) {
  if (!asset || asset.status !== "READY") return { ready: false, reason: "The media file is not ready." };
  if (!organisationId || !productFamily || !PRODUCT_MUSIC_USE[productFamily]) return { ready: false, reason: "An authorised product and organisation are required." };
  if (asset.organisationId !== organisationId && asset.organisationId !== null) return { ready: false, reason: "This media belongs to another organisation." };
  if (asset.mediaType === "MUSIC" || asset.track || asset.libraryType === "RUVANAS_CATALOGUE") {
    const requiredUse = PRODUCT_MUSIC_USE[productFamily];
    if (rightsUse && rightsUse !== requiredUse) return { ready: false, reason: "The channel's product use does not match this Studio session." };
    const territories = String(asset.track?.permittedTerritories || "").split(/[,;\n]/).map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (!territory && territories.length && !territories.some((value) => ["WORLDWIDE", "GLOBAL", "ALL", "*"].includes(value))) {
      return { ready: false, reason: "Set the channel territory before preparing territory-restricted music." };
    }
    const eligibility = musicTrackEligibility(asset.track && { ...asset.track, mediaAsset: asset }, {
      organisationId, requiredUse, territory, licensedCatalogueLevel: licensedMusicCatalogueLevel,
      configuredGenres, instant
    });
    return eligibility.playable
      ? { ready: true, reason: "Music rights are current for this product and territory." }
      : { ready: false, reason: `Music is not cleared for this session (${eligibility.reason}).` };
  }
  if (asset.organisationId !== organisationId) return { ready: false, reason: "Only organisation-owned non-music media can be prepared here." };
  return { ready: true, reason: "Organisation-owned protected non-music media." };
}

export function studioManualOutputAvailability() {
  // A queue status is not a playback acknowledgement. Revisit only when a
  // server/player or encoder adapter consumes StudioPlayoutSession authoritatively.
  return { connected: false, reason: "Manual output is not connected to a verified player or encoder yet. AutoDJ remains in control." };
}

export function assertStudioManualOutputBridge() {
  const state = studioManualOutputAvailability();
  if (!state.connected) throw Object.assign(new Error(state.reason), { status: 409 });
}

export function normalizePreparedItem(input, asset, { studioLevel = "BASIC", readiness } = {}) {
  const durationMs = Math.max(0, Number(asset?.durationSeconds || 0) * 1000);
  const cueInMs = Math.round(clamp(input.cueInMs, 0, Math.max(0, durationMs - 1)));
  const cueOutMs = input.cueOutMs == null ? null : Math.round(clamp(input.cueOutMs, cueInMs + 1, durationMs));
  const playableDuration = Math.max(0, (cueOutMs || durationMs) - cueInMs);
  return {
    mediaAssetId: asset.id,
    title: String(input.title || asset.name || "Prepared audio").trim().slice(0, 160),
    artistOrProgramme: String(input.artistOrProgramme || "").trim().slice(0, 160) || null,
    itemType: String(input.itemType || asset.mediaType || "AUDIO").trim().slice(0, 60),
    durationMs: playableDuration || null,
    cueInMs,
    cueOutMs,
    fadeInMs: Math.round(clamp(input.fadeInMs, 0, playableDuration)),
    fadeOutMs: Math.round(clamp(input.fadeOutMs, 0, playableDuration)),
    gainDb: studioLevel === "PRO" ? clamp(input.gainDb, -18, 12) : 0,
    rightsReady: readiness?.ready === true,
    readinessReason: readiness?.reason || null
  };
}

export function queueStatus(items = []) {
  const future = items.filter((item) => item.area === "LIVE" && item.status === "READY");
  return { futureCount: future.length, lowQueue: future.length <= LOW_QUEUE_THRESHOLD, empty: future.length === 0 };
}

export function fallbackForQueue(session, items = []) {
  const status = queueStatus(items);
  if (session.mode === "MANUAL" && status.empty) return { mode: "AUTO", status: "FALLBACK", outputHealth: "AUTODJ_FALLBACK", reason: "Manual queue exhausted; AutoDJ fallback resumed." };
  return null;
}

export function safeEndManualSession(session) {
  if (!["ACTIVE", "FALLBACK"].includes(session.status)) return session;
  return { mode: "AUTO", status: "ENDED", outputHealth: "AUTODJ_ACTIVE", endedReason: "Manual session ended safely; schedule or AutoDJ resumed." };
}

export function nextReconnectDelayMs(attempt) {
  return Math.min(60_000, 1_000 * (2 ** Math.min(6, Math.max(0, Number(attempt) || 0))));
}
