import { djGrantAvailability } from "./dj-access.mjs";

export const BROWSER_STUDIO_HEARTBEAT_SECONDS = 15;
export const BROWSER_STUDIO_STALE_SECONDS = 45;
export const BROWSER_STUDIO_MAX_HOURS = 6;

const OPEN_STATUSES = new Set(["CREATED", "SOUNDCHECK", "READY", "ON_AIR"]);
const MANAGER_ACTIONS = new Set(["CREATE", "FORCE_FALLBACK", "END"]);
const PRESENTER_ACTIONS = new Set(["START_SOUNDCHECK", "SAVE_SOUNDCHECK", "PREPARE", "GO_LIVE", "HEARTBEAT", "FORCE_FALLBACK", "END"]);

const cleanText = (value, maximum = 200) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

function date(value, label) {
  const result = new Date(value);
  if (Number.isNaN(result.valueOf())) throw new Error(`${label} must be a valid date and time.`);
  return result;
}

export function browserLiveProviderConfigured(env = process.env) {
  const apiUrl = cleanText(env.BROWSER_LIVE_PROVIDER_API_URL, 2_048);
  const apiToken = cleanText(env.BROWSER_LIVE_PROVIDER_API_TOKEN, 4_096);
  if (!apiUrl || !apiToken) return false;
  try {
    const parsed = new URL(apiUrl);
    return parsed.protocol === "https:" || (env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
  } catch {
    return false;
  }
}

export function parseBrowserStudioInput(input = {}, now = new Date()) {
  const title = cleanText(input.title, 180);
  const channelId = cleanText(input.channelId, 120);
  const djAccessGrantId = cleanText(input.djAccessGrantId, 120);
  const scheduledStart = date(input.scheduledStart, "The studio start");
  const scheduledEnd = date(input.scheduledEnd, "The studio end");
  if (title.length < 2) throw new Error("Add a clear live-studio title.");
  if (!channelId) throw new Error("Choose an active channel.");
  if (!djAccessGrantId) throw new Error("Choose a presenter with Browser Live Studio access.");
  if (scheduledEnd <= scheduledStart) throw new Error("The studio end must be after its start.");
  if (scheduledEnd.getTime() - scheduledStart.getTime() > BROWSER_STUDIO_MAX_HOURS * 60 * 60_000) throw new Error(`A Browser Live Studio session cannot exceed ${BROWSER_STUDIO_MAX_HOURS} hours.`);
  if (scheduledEnd <= now) throw new Error("The studio session cannot end in the past.");
  return {
    title,
    channelId,
    djAccessGrantId,
    scheduledStart,
    scheduledEnd,
    recordEnabled: Boolean(input.recordEnabled),
    retentionApproved: Boolean(input.retentionApproved)
  };
}

export function normalizeBrowserMixerState(input = {}) {
  return {
    microphoneGainDb: Math.round(clamp(input.microphoneGainDb, -24, 12, 0) * 10) / 10,
    bedGainDb: Math.round(clamp(input.bedGainDb, -60, 0, -18) * 10) / 10,
    duckingDb: Math.round(clamp(input.duckingDb, -30, 0, -12) * 10) / 10,
    limiterEnabled: input.limiterEnabled !== false,
    echoCancellation: input.echoCancellation !== false,
    noiseSuppression: input.noiseSuppression !== false
  };
}

export function assessBrowserSoundcheck(input = {}) {
  const microphoneDetected = Boolean(input.microphoneDetected);
  const permissionGranted = Boolean(input.permissionGranted);
  const sampleRate = Number(input.sampleRate);
  const peakDb = Number(input.peakDb);
  const latencyMs = Number(input.latencyMs);
  const blockers = [];
  if (!permissionGranted) blockers.push("MICROPHONE_PERMISSION_REQUIRED");
  if (!microphoneDetected) blockers.push("MICROPHONE_NOT_DETECTED");
  if (!Number.isFinite(peakDb) || peakDb < -55) blockers.push("MICROPHONE_LEVEL_TOO_LOW");
  if (!Number.isFinite(sampleRate) || sampleRate < 32_000) blockers.push("SAMPLE_RATE_UNSUPPORTED");
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 1_500) blockers.push("LATENCY_UNACCEPTABLE");
  const degraded = blockers.length === 0 && (peakDb > -1 || peakDb < -40 || latencyMs > 500 || sampleRate < 44_100);
  return {
    quality: blockers.length ? "FAILED" : degraded ? "DEGRADED" : "GOOD",
    blockers,
    evidence: {
      microphoneDetected,
      permissionGranted,
      sampleRate: Number.isFinite(sampleRate) ? Math.round(sampleRate) : null,
      peakDb: Number.isFinite(peakDb) ? Math.round(peakDb * 10) / 10 : null,
      latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
      mixer: normalizeBrowserMixerState(input.mixer)
    }
  };
}

export function assertBrowserStudioGrant(grant, { channelId, recordEnabled = false, now = new Date() } = {}) {
  if (!grant || grant.channelId !== channelId) throw new Error("The DJ access grant does not belong to this channel.");
  const studio = djGrantAvailability(grant, now, "START_BROWSER_STUDIO");
  if (!studio.allowed) throw new Error(`Browser Live Studio access is unavailable: ${studio.reason}.`);
  if (recordEnabled && !djGrantAvailability(grant, now, "RECORD_LIVE_SESSION").allowed) throw new Error("This presenter does not have live-recording permission.");
  return true;
}

export function parseBrowserStudioAction(input = {}) {
  const action = cleanText(input.action, 40).toUpperCase();
  if (![...MANAGER_ACTIONS, ...PRESENTER_ACTIONS].includes(action)) throw new Error("Choose a supported Browser Live Studio action.");
  const sessionId = cleanText(input.sessionId, 120);
  if (action !== "CREATE" && !sessionId) throw new Error("Choose a Browser Live Studio session.");
  return {
    action,
    sessionId,
    reason: cleanText(input.reason, 1_000) || null,
    soundcheck: input.soundcheck || null,
    mixer: input.mixer ? normalizeBrowserMixerState(input.mixer) : null,
    expectedVersion: Number.isInteger(input.expectedVersion) ? input.expectedVersion : null
  };
}

export function browserStudioTransition(session, action, { soundcheck = null, providerConfigured = false, now = new Date(), reason = null } = {}) {
  const status = session?.status;
  if (!OPEN_STATUSES.has(status) && !["FORCE_FALLBACK", "END"].includes(action)) throw new Error("This Browser Live Studio session is closed.");
  if (action === "START_SOUNDCHECK") {
    if (!new Set(["CREATED", "SOUNDCHECK"]).has(status)) throw new Error("Soundcheck cannot start from the current studio state.");
    return { status: "SOUNDCHECK", presenterJoinedAt: session.presenterJoinedAt || now, lastHeartbeatAt: now };
  }
  if (action === "SAVE_SOUNDCHECK") {
    if (status !== "SOUNDCHECK") throw new Error("Start soundcheck before saving its result.");
    const assessment = assessBrowserSoundcheck(soundcheck || {});
    return { connectionQuality: assessment.quality, soundcheckJson: assessment.evidence, lastHeartbeatAt: now, assessment };
  }
  if (action === "PREPARE") {
    if (status !== "SOUNDCHECK" || session.connectionQuality !== "GOOD") throw new Error("A good soundcheck is required before preparing the live connection.");
    if (!providerConfigured) throw new Error("Browser Live Studio needs a configured real-time media provider before it can broadcast.");
    return { status: "READY", connectionApprovedAt: now, lastHeartbeatAt: now };
  }
  if (action === "GO_LIVE") {
    if (status !== "READY" || !session.providerSessionRef || !session.externalLiveSourceId) throw new Error("Prepare the protected live connection before going on air.");
    if (now < new Date(session.scheduledStart.getTime() - 30 * 60_000) || now >= new Date(session.scheduledEnd)) throw new Error("Go live is available from 30 minutes before the scheduled start until the session ends.");
    return { status: "ON_AIR", liveStartedAt: now, lastHeartbeatAt: now };
  }
  if (action === "HEARTBEAT") {
    if (!new Set(["SOUNDCHECK", "READY", "ON_AIR"]).has(status)) throw new Error("This studio is not accepting heartbeats.");
    return { lastHeartbeatAt: now };
  }
  if (action === "FORCE_FALLBACK") {
    if (!new Set(["SOUNDCHECK", "READY", "ON_AIR"]).has(status)) throw new Error("Fallback is unavailable from the current studio state.");
    if (!reason) throw new Error("Add a reason before activating fallback.");
    return { status: "FALLBACK", fallbackActivatedAt: now, endedAt: now, endReason: reason, lastHeartbeatAt: now };
  }
  if (action === "END") {
    if (!new Set(["CREATED", "SOUNDCHECK", "READY", "ON_AIR", "FALLBACK"]).has(status)) throw new Error("This studio has already ended.");
    if (!reason) throw new Error("Add a reason before ending the studio session.");
    return { status: "ENDED", endedAt: now, endReason: reason, lastHeartbeatAt: now };
  }
  throw new Error("Choose a supported Browser Live Studio action.");
}

export function browserStudioIsStale(session, now = new Date()) {
  if (!new Set(["READY", "ON_AIR"]).has(session?.status)) return false;
  const heartbeat = session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt) : null;
  return !heartbeat || now.getTime() - heartbeat.getTime() > BROWSER_STUDIO_STALE_SECONDS * 1_000;
}

export function validateProviderAllocation(value = {}, { production = process.env.NODE_ENV === "production" } = {}) {
  const providerSessionRef = cleanText(value.sessionRef, 300);
  const providerKey = cleanText(value.providerKey, 80) || "GENERIC_WHIP";
  const whipEndpoint = cleanText(value.whipEndpoint, 2_048);
  const publishToken = cleanText(value.publishToken, 4_096);
  const playbackUrl = cleanText(value.playbackUrl, 2_048);
  const playbackToken = cleanText(value.playbackToken, 4_096) || null;
  const expiresAt = date(value.expiresAt, "The provider session expiry");
  if (!providerSessionRef || !whipEndpoint || !publishToken || !playbackUrl) throw new Error("The media provider returned an incomplete Browser Live Studio allocation.");
  for (const [label, raw] of [["WHIP endpoint", whipEndpoint], ["playback URL", playbackUrl]]) {
    const url = new URL(raw);
    if (url.username || url.password || (url.protocol !== "https:" && (production || !["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error(`${label} must use a public HTTPS address without embedded credentials.`);
  }
  if (expiresAt <= new Date()) throw new Error("The media provider returned an expired Browser Live Studio allocation.");
  return { providerSessionRef, providerKey, whipEndpoint, publishToken, playbackUrl, playbackToken, expiresAt };
}

export function safeBrowserStudioSession(session) {
  return {
    id: session.id,
    title: session.title,
    product: session.product,
    status: session.status,
    connectionQuality: session.connectionQuality,
    channel: session.channel,
    presenter: session.djAccessGrant?.granteeMembership?.user || null,
    grantLabel: session.djAccessGrant?.label || null,
    scheduledStart: session.scheduledStart?.toISOString?.() || session.scheduledStart,
    scheduledEnd: session.scheduledEnd?.toISOString?.() || session.scheduledEnd,
    recordEnabled: session.recordEnabled,
    retentionApproved: session.retentionApproved,
    mixerState: session.mixerStateJson || normalizeBrowserMixerState(),
    providerReady: Boolean(session.providerSessionRef && session.externalLiveSourceId),
    providerKey: session.providerKey || null,
    providerExpiresAt: session.providerExpiresAt?.toISOString?.() || session.providerExpiresAt || null,
    presenterJoinedAt: session.presenterJoinedAt?.toISOString?.() || session.presenterJoinedAt || null,
    lastHeartbeatAt: session.lastHeartbeatAt?.toISOString?.() || session.lastHeartbeatAt || null,
    liveStartedAt: session.liveStartedAt?.toISOString?.() || session.liveStartedAt || null,
    fallbackActivatedAt: session.fallbackActivatedAt?.toISOString?.() || session.fallbackActivatedAt || null,
    endedAt: session.endedAt?.toISOString?.() || session.endedAt || null,
    endReason: session.endReason || null,
    sessionVersion: session.sessionVersion || 0,
    createdAt: session.createdAt?.toISOString?.() || session.createdAt,
    updatedAt: session.updatedAt?.toISOString?.() || session.updatedAt
  };
}
