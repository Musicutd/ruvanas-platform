import { consentIsCurrent } from "./school-radio.mjs";
import {
  normalizePodcastChapters,
  normalizeTranscriptSegments
} from "./podcast-core.mjs";
import { transitionNewsStory } from "./newsroom.mjs";

export { normalizePodcastChapters, normalizeTranscriptSegments, transitionNewsStory };

const LIVE_TRANSITIONS = Object.freeze({
  START_SOUNDCHECK: new Set(["CREATED"]),
  APPROVE_CONNECTION: new Set(["SOUNDCHECK"]),
  GO_LIVE: new Set(["READY"]),
  FORCE_FALLBACK: new Set(["SOUNDCHECK", "READY", "ON_AIR"]),
  END: new Set(["CREATED", "SOUNDCHECK", "READY", "ON_AIR", "FALLBACK"])
});

function cleanText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

export function validatePodcastPublication({
  publicationScope,
  episodeStatus,
  hasApprovedAudio,
  transcriptStatus,
  publicPublishingEnabled = false,
  contributorConsents = []
}) {
  if (episodeStatus !== "APPROVED") throw new Error("Only a staff-approved episode can be published.");
  if (!hasApprovedAudio) throw new Error("The episode needs an approved audio submission before publishing.");
  if (publicationScope === "PUBLIC") {
    if (!publicPublishingEnabled) throw new Error("Public School Radio publishing is not enabled for this organisation.");
    if (transcriptStatus && transcriptStatus !== "APPROVED") throw new Error("The transcript must be staff-approved before public publishing.");
    if (!contributorConsents.length || contributorConsents.some((record) => !consentIsCurrent(record))) {
      throw new Error("Every student contributor needs current recorded consent before public publishing.");
    }
  }
  return { scope: publicationScope === "PUBLIC" ? "PUBLIC" : "INTERNAL_ONLY", status: "PUBLISHED" };
}

export function validateLiveWindow({ scheduledStart, scheduledEnd }) {
  const start = scheduledStart instanceof Date ? scheduledStart : new Date(scheduledStart);
  const end = scheduledEnd instanceof Date ? scheduledEnd : new Date(scheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new Error("The live session needs a valid end time after its start time.");
  if (end.getTime() - start.getTime() > 6 * 60 * 60 * 1000) throw new Error("A live studio session cannot be longer than six hours.");
  return { scheduledStart: start, scheduledEnd: end };
}

export function assessConnectionQuality({ latencyMs, packetLossPercent, microphoneDetected, levelDetected }) {
  if (!microphoneDetected || !levelDetected) return "FAILED";
  const latency = Number(latencyMs);
  const packetLoss = Number(packetLossPercent);
  if (!Number.isFinite(latency) || !Number.isFinite(packetLoss) || latency < 0 || packetLoss < 0) return "FAILED";
  if (latency > 800 || packetLoss > 10) return "FAILED";
  if (latency > 350 || packetLoss > 3) return "DEGRADED";
  return "GOOD";
}

export function transitionLiveStudio({ currentStatus, action, connectionQuality = "UNKNOWN", reason = null }) {
  if (!LIVE_TRANSITIONS[action]?.has(currentStatus)) throw new Error(`A ${currentStatus.toLowerCase().replaceAll("_", " ")} live session cannot use ${action.toLowerCase().replaceAll("_", " ")}.`);
  const cleanReason = cleanText(reason, 1000) || null;
  if (action === "APPROVE_CONNECTION" && connectionQuality !== "GOOD") throw new Error("The teacher can approve only a good soundcheck.");
  if (new Set(["FORCE_FALLBACK", "END"]).has(action) && !cleanReason) throw new Error("An audit reason is required for this live control action.");
  if (action === "START_SOUNDCHECK") return { status: "SOUNDCHECK" };
  if (action === "APPROVE_CONNECTION") return { status: "READY", connectionApprovedAt: new Date() };
  if (action === "GO_LIVE") return { status: "ON_AIR", liveStartedAt: new Date() };
  if (action === "FORCE_FALLBACK") return { status: "FALLBACK", fallbackActivatedAt: new Date(), endReason: cleanReason };
  return { status: "ENDED", endedAt: new Date(), endReason: cleanReason };
}

export function automaticLiveFallback({ currentStatus, connectionQuality }) {
  if (currentStatus === "ON_AIR" && connectionQuality === "FAILED") {
    return { status: "FALLBACK", fallbackActivatedAt: new Date(), endReason: "Automatic fallback: live connection failed." };
  }
  return { status: currentStatus };
}

export function validateLiveRecording({ recordEnabled, retentionApproved }) {
  if (recordEnabled && !retentionApproved) throw new Error("Live recording requires approved retention before the session is created.");
  return Boolean(recordEnabled && retentionApproved);
}

