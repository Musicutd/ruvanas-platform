import { musicTrackEligibility } from "./media-library-pro.mjs";

const MAX_TRACKS_PER_MODE = 200;

export function makeRadioSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function validateMusicModeTracks(entries) {
  if (!Array.isArray(entries)) {
    return { ok: false, error: "Track selection must be a list." };
  }

  if (entries.length > MAX_TRACKS_PER_MODE) {
    return {
      ok: false,
      error: `A music mode can contain at most ${MAX_TRACKS_PER_MODE} tracks.`
    };
  }

  const seen = new Set();
  const tracks = [];

  for (const entry of entries) {
    const trackId = typeof entry?.trackId === "string" ? entry.trackId.trim() : "";
    const weight = Number(entry?.weight ?? 100);

    if (!trackId) {
      return { ok: false, error: "Every selected track needs an ID." };
    }

    if (seen.has(trackId)) {
      return { ok: false, error: "The same track cannot be added twice." };
    }

    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
      return {
        ok: false,
        error: "Track weights must be whole numbers between 1 and 1000."
      };
    }

    seen.add(trackId);
    tracks.push({ trackId, weight });
  }

  return { ok: true, tracks };
}

export function canUseTrackForOrganisation(track, organisationId, instant = new Date()) {
  return musicTrackEligibility(track, { organisationId, instant }).playable;
}

