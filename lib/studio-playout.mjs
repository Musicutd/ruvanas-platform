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

export function studioQueueReadiness(asset, { licensedCatalogueEnabled = false, licensedMusicCatalogueEnabled = false } = {}) {
  if (!asset || asset.status !== "READY") return { ready: false, reason: "The media file is not ready." };
  if (asset.organisationId) return { ready: true, reason: "Organisation-owned protected media." };
  if (asset.libraryType !== "RUVANAS_CATALOGUE" || !(licensedCatalogueEnabled || licensedMusicCatalogueEnabled)) return { ready: false, reason: "Licensed catalogue access is not available." };
  const track = asset.track;
  if (!track || track.status !== "READY") return { ready: false, reason: "The licensed track has not passed rights review." };
  if (track.licenceExpiresAt && new Date(track.licenceExpiresAt) < new Date()) return { ready: false, reason: "The media licence has expired." };
  return { ready: true, reason: "Licensed media is ready for this organisation." };
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
