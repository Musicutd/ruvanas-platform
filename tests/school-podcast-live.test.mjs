import assert from "node:assert/strict";
import test from "node:test";
import {
  assessConnectionQuality,
  automaticLiveFallback,
  normalizePodcastChapters,
  normalizeTranscriptSegments,
  transitionLiveStudio,
  transitionNewsStory,
  validateLiveRecording,
  validateLiveWindow,
  validatePodcastPublication
} from "../lib/school-podcast-live.mjs";

test("podcast chapters and transcript segments are normalized and ordered", () => {
  assert.deepEqual(normalizePodcastChapters([{ startMs: 5000, title: "Second" }, { startMs: 0, title: "Opening" }]).map((item) => item.title), ["Opening", "Second"]);
  assert.deepEqual(normalizeTranscriptSegments([{ startMs: 1000, endMs: 2000, text: "Welcome", speaker: "Presenter" }])[0], { startMs: 1000, endMs: 2000, text: "Welcome", speaker: "Presenter" });
  assert.throws(() => normalizeTranscriptSegments([{ startMs: 0, endMs: 1, text: "" }]), /needs text/);
});

test("public podcast publishing requires approval, audio, capability, transcript review, and consent", () => {
  const approvedConsent = { status: "GRANTED", expiresAt: null, revokedAt: null };
  assert.equal(validatePodcastPublication({ publicationScope: "INTERNAL_ONLY", episodeStatus: "APPROVED", hasApprovedAudio: true }).status, "PUBLISHED");
  assert.throws(() => validatePodcastPublication({ publicationScope: "PUBLIC", episodeStatus: "APPROVED", hasApprovedAudio: true, publicPublishingEnabled: false }), /not enabled/);
  assert.throws(() => validatePodcastPublication({ publicationScope: "PUBLIC", episodeStatus: "APPROVED", hasApprovedAudio: true, publicPublishingEnabled: true, transcriptStatus: "NEEDS_REVIEW", contributorConsents: [approvedConsent] }), /transcript/);
  assert.equal(validatePodcastPublication({ publicationScope: "PUBLIC", episodeStatus: "APPROVED", hasApprovedAudio: true, publicPublishingEnabled: true, transcriptStatus: "APPROVED", contributorConsents: [approvedConsent] }).scope, "PUBLIC");
});

test("newsroom workflow enforces review feedback and interview consent", () => {
  assert.equal(transitionNewsStory({ currentStatus: "PITCH", action: "ASSIGN" }).status, "ASSIGNED");
  assert.equal(transitionNewsStory({ currentStatus: "AUDIO_PRODUCTION", action: "SUBMIT" }).status, "IN_REVIEW");
  assert.throws(() => transitionNewsStory({ currentStatus: "IN_REVIEW", action: "REQUEST_CHANGES" }), /feedback/);
  assert.throws(() => transitionNewsStory({ currentStatus: "IN_REVIEW", action: "APPROVE", hasInterviewAsset: true }), /consent/);
});

test("live studio requires a bounded window, healthy soundcheck, and retention approval", () => {
  const window = validateLiveWindow({ scheduledStart: "2026-09-01T08:00:00Z", scheduledEnd: "2026-09-01T09:00:00Z" });
  assert.equal(window.scheduledEnd.getTime() - window.scheduledStart.getTime(), 3_600_000);
  assert.throws(() => validateLiveWindow({ scheduledStart: "2026-09-01T09:00:00Z", scheduledEnd: "2026-09-01T08:00:00Z" }), /valid end time/);
  assert.equal(assessConnectionQuality({ latencyMs: 80, packetLossPercent: 0.2, microphoneDetected: true, levelDetected: true }), "GOOD");
  assert.equal(assessConnectionQuality({ latencyMs: 900, packetLossPercent: 1, microphoneDetected: true, levelDetected: true }), "FAILED");
  assert.throws(() => transitionLiveStudio({ currentStatus: "SOUNDCHECK", action: "APPROVE_CONNECTION", connectionQuality: "DEGRADED" }), /good soundcheck/);
  assert.equal(transitionLiveStudio({ currentStatus: "SOUNDCHECK", action: "APPROVE_CONNECTION", connectionQuality: "GOOD" }).status, "READY");
  assert.equal(automaticLiveFallback({ currentStatus: "ON_AIR", connectionQuality: "FAILED" }).status, "FALLBACK");
  assert.throws(() => validateLiveRecording({ recordEnabled: true, retentionApproved: false }), /retention/);
});

