const RETAIL_STATION = "cmvmg7rp1000flf2kelb1kzax";
const RETAIL_STREAM = "https://ruvanastestretail-radio105network.radioca.st/stream";

// A server-authorized manifest is the source of permission. This extra client
// check prevents a malformed response from turning this pilot player into an
// arbitrary URL player. No music files or source credentials are accepted.
export function subscriberTestStreamData(state, now = Date.now()) {
  const stream = state?.subscriberTestStream;
  const expiry = Date.parse(stream?.expiresAt);
  if (!state?.player?.id || stream?.kind !== "RETAIL_SHARED_STREAM" ||
      stream.stationId !== RETAIL_STATION || stream.streamUrl !== RETAIL_STREAM ||
      typeof stream.channelId !== "string" || !/^c[a-z0-9]{24}$/.test(stream.channelId) ||
      !Number.isFinite(expiry) || expiry <= now) return null;
  return { kind: stream.kind, stationId: stream.stationId, channelId: stream.channelId,
    streamUrl: RETAIL_STREAM, name: "Retail radio", expiresAt: new Date(expiry).toISOString() };
}

export function subscriberStreamObservation(audio, event, previousPosition = null, now = new Date()) {
  const position = Number.isFinite(audio?.currentTime) ? Math.min(31_536_000, Math.max(0, audio.currentTime)) : 0;
  const canPlay = audio && !audio.paused && !audio.ended && !audio.error && !audio.muted && audio.volume > 0 && audio.readyState >= 2;
  const advanced = Number.isFinite(previousPosition) && position > previousPosition;
  const playing = Boolean(canPlay && (event === "playing" || event === "progress" && advanced));
  const failed = event === "error" || Boolean(audio?.error);
  return { state: failed ? "FAILED" : playing ? "PLAYING" : "PAUSED", positionSeconds: position,
    observedAt: now.toISOString(), sourceStatus: failed ? "DISCONNECTED" : playing ? "CONNECTED" :
      ["waiting", "stalled"].includes(event) || event === "progress" && canPlay ? "DEGRADED" : "DISCONNECTED" };
}

export function subscriberStreamEvidence(observation) {
  return { state: observation.state, positionSeconds: observation.positionSeconds, observedAt: observation.observedAt };
}
