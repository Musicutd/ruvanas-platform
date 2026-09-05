export const MAX_SEGUE_OVERLAP_MS = 30_000;
export const MAX_VOICE_TRACK_MS = 10 * 60 * 1000;

const integer = (value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is outside the allowed range.`);
  return parsed;
};

const identifier = (value, name) => {
  const parsed = String(value || "").trim();
  if (!parsed || parsed.length > 120) throw new Error(`Choose a valid ${name}.`);
  return parsed;
};

export function voiceTrackSegueTimeline(input) {
  const voiceDurationMs = input.voiceTrimEndMs - input.voiceTrimStartMs;
  const outgoingStartsAtMs = 0;
  const outgoingEndsAtMs = input.outgoingCueOutMs;
  const voiceStartsAtMs = outgoingEndsAtMs - input.outgoingOverlapMs;
  const voiceEndsAtMs = voiceStartsAtMs + voiceDurationMs;
  const incomingStartsAtMs = voiceEndsAtMs - input.incomingOverlapMs;
  return {
    outgoingStartsAtMs,
    outgoingEndsAtMs,
    voiceStartsAtMs,
    voiceEndsAtMs,
    incomingStartsAtMs,
    incomingIntroEndsAtMs: incomingStartsAtMs + input.incomingIntroEndMs,
    voiceDurationMs,
    packageDurationMs: voiceDurationMs - input.incomingOverlapMs + input.incomingIntroEndMs
  };
}

export function normalizeVoiceTrackSegue(input = {}, durations = {}) {
  const title = String(input.title || "").trim().slice(0, 160);
  if (title.length < 2) throw new Error("Enter a voice-track title.");
  const voiceDurationMs = integer(durations.voiceDurationMs, "voice render duration", { min: 1, max: MAX_VOICE_TRACK_MS });
  const outgoingDurationMs = integer(durations.outgoingDurationMs, "outgoing track duration", { min: 1 });
  const incomingDurationMs = integer(durations.incomingDurationMs, "incoming track duration", { min: 1 });
  const voiceTrimStartMs = integer(input.voiceTrimStartMs ?? 0, "voice start cue", { max: voiceDurationMs - 1 });
  const voiceTrimEndMs = integer(input.voiceTrimEndMs ?? voiceDurationMs, "voice end cue", { min: voiceTrimStartMs + 1, max: voiceDurationMs });
  const outgoingCueOutMs = integer(input.outgoingCueOutMs ?? outgoingDurationMs, "outgoing cue", { min: 1, max: outgoingDurationMs });
  const incomingIntroEndMs = integer(input.incomingIntroEndMs ?? Math.min(15_000, incomingDurationMs), "incoming intro cue", { min: 0, max: incomingDurationMs });
  const outgoingOverlapMs = integer(input.outgoingOverlapMs ?? 2_000, "outgoing overlap", { max: Math.min(MAX_SEGUE_OVERLAP_MS, outgoingCueOutMs, voiceTrimEndMs - voiceTrimStartMs) });
  const incomingOverlapMs = integer(input.incomingOverlapMs ?? 2_000, "incoming overlap", { max: Math.min(MAX_SEGUE_OVERLAP_MS, incomingIntroEndMs, voiceTrimEndMs - voiceTrimStartMs) });
  if (outgoingOverlapMs + incomingOverlapMs > voiceTrimEndMs - voiceTrimStartMs) throw new Error("The two overlaps cannot consume more than the complete voice link.");
  const duckingDb = Number(input.duckingDb ?? -12);
  if (!Number.isFinite(duckingDb) || duckingDb < -36 || duckingDb > 0) throw new Error("Music ducking must be between -36 dB and 0 dB.");
  const normalized = {
    title,
    channelId: identifier(input.channelId, "channel"),
    audioRenderId: identifier(input.audioRenderId, "approved voice render"),
    outgoingTrackId: identifier(input.outgoingTrackId, "outgoing track"),
    incomingTrackId: identifier(input.incomingTrackId, "incoming track"),
    outgoingCueOutMs,
    voiceTrimStartMs,
    voiceTrimEndMs,
    incomingIntroEndMs,
    outgoingOverlapMs,
    incomingOverlapMs,
    duckingDb
  };
  return { ...normalized, timeline: voiceTrackSegueTimeline(normalized) };
}

export function assertVoiceTrackSegueApprovable(segue, { previewAcknowledged = false } = {}) {
  if (segue?.status !== "DRAFT") throw new Error("Only a draft voice track can be approved.");
  if (!previewAcknowledged) throw new Error("Listen to the complete segue preview before approval.");
  if (segue?.audioRender?.status !== "SUCCEEDED" || segue?.voicePromoVersion?.status !== "APPROVED" || segue?.voicePromoVersion?.qcStatus !== "PASSED" || segue?.voicePromoVersion?.mediaAsset?.status !== "READY") {
    throw new Error("The voice link needs a completed, approved and quality-checked AudioLab render.");
  }
  for (const [track, label] of [[segue?.outgoingTrack, "outgoing"], [segue?.incomingTrack, "incoming"]]) {
    if (track?.status !== "READY" || track?.mediaAsset?.status !== "READY") throw new Error(`The ${label} track is no longer ready for playout.`);
  }
  return true;
}

export function safeVoiceTrackSegue(segue) {
  const timeline = voiceTrackSegueTimeline(segue);
  return {
    id: segue.id,
    title: segue.title,
    status: segue.status,
    version: segue.version,
    channel: segue.channel ? { id: segue.channel.id, name: segue.channel.station ? `${segue.channel.station.name} / ${segue.channel.name}` : segue.channel.name } : null,
    audioProject: segue.audioProject ? { id: segue.audioProject.id, title: segue.audioProject.title, type: segue.audioProject.type } : null,
    audioRenderId: segue.audioRenderId,
    voice: segue.voicePromoVersion ? {
      name: segue.voicePromoVersion.promoAsset?.name || segue.audioProject?.title || "Voice link",
      durationMs: Number(segue.voicePromoVersion.mediaAsset?.durationSeconds || 0) * 1000,
      streamUrl: segue.voicePromoVersion.mediaAssetId ? `/api/media/${segue.voicePromoVersion.mediaAssetId}/stream` : null
    } : null,
    outgoingTrack: segue.outgoingTrack ? { id: segue.outgoingTrack.id, name: `${segue.outgoingTrack.artist} — ${segue.outgoingTrack.title}`, durationMs: Number(segue.outgoingTrack.mediaAsset?.durationSeconds || 0) * 1000, streamUrl: `/api/media/${segue.outgoingTrack.mediaAssetId}/stream` } : null,
    incomingTrack: segue.incomingTrack ? { id: segue.incomingTrack.id, name: `${segue.incomingTrack.artist} — ${segue.incomingTrack.title}`, durationMs: Number(segue.incomingTrack.mediaAsset?.durationSeconds || 0) * 1000, streamUrl: `/api/media/${segue.incomingTrack.mediaAssetId}/stream` } : null,
    outgoingCueOutMs: segue.outgoingCueOutMs,
    voiceTrimStartMs: segue.voiceTrimStartMs,
    voiceTrimEndMs: segue.voiceTrimEndMs,
    incomingIntroEndMs: segue.incomingIntroEndMs,
    outgoingOverlapMs: segue.outgoingOverlapMs,
    incomingOverlapMs: segue.incomingOverlapMs,
    duckingDb: segue.duckingDb,
    timeline,
    approvedAt: segue.approvedAt?.toISOString?.() || null,
    updatedAt: segue.updatedAt?.toISOString?.() || null
  };
}
