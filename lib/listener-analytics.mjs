import crypto from "node:crypto";

export const LISTENER_ANALYTICS_EVENT_TYPES = Object.freeze([
  "SESSION_STARTED",
  "HEARTBEAT",
  "SESSION_ENDED",
  "PLAYBACK_ERROR"
]);
export const LISTENER_ANALYTICS_BATCH_LIMIT = 20;
export const LISTENER_ANALYTICS_MAX_EVENT_AGE_MS = 15 * 60 * 1000;
export const LISTENER_ANALYTICS_MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
export const LISTENER_ANALYTICS_TOKEN_TTL_SECONDS = 2 * 60 * 60;
export const LISTENER_ANALYTICS_RAW_RETENTION_DAYS = 31;
export const LISTENER_ANALYTICS_AGGREGATE_RETENTION_DAYS = 395;
export const LISTENER_ANALYTICS_MAX_REPORT_DAYS = 93;

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const CLIENT_EVENT_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function analyticsSecret(secret = process.env.SESSION_SECRET) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function signPayload(encoded, secret) {
  return crypto.createHmac("sha256", analyticsSecret(secret)).update(encoded).digest("base64url");
}

export function listenerSessionHash(sessionId, secret) {
  if (!SESSION_ID_PATTERN.test(sessionId || "")) throw new Error("A private random listener session ID is required.");
  return crypto.createHmac("sha256", analyticsSecret(secret)).update(`listener-session:${sessionId}`).digest("hex");
}

export function createListenerTelemetryToken({ organisationId, channelId, sessionId, expiresAt, issuedAt = new Date() }, secret) {
  const expiry = Math.floor(new Date(expiresAt).getTime() / 1000);
  const issued = Math.floor(new Date(issuedAt).getTime() / 1000);
  if (!organisationId || !channelId || !Number.isSafeInteger(expiry) || !Number.isSafeInteger(issued) || expiry <= issued || expiry - issued > LISTENER_ANALYTICS_TOKEN_TTL_SECONDS) {
    throw new Error("A channel-scoped telemetry token requires an expiry within two hours.");
  }
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    organisationId,
    channelId,
    sessionHash: listenerSessionHash(sessionId, secret),
    iat: issued,
    exp: expiry
  })).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyListenerTelemetryToken(token, { instant = new Date(), secret } = {}) {
  const [payload, signature, ...extra] = typeof token === "string" ? token.split(".") : [];
  if (extra.length || !payload || !signature) return null;
  const expected = signPayload(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (value.v !== 1 || !value.organisationId || !value.channelId || !HASH_PATTERN.test(value.sessionHash || "")) return null;
    const now = Math.floor(instant.getTime() / 1000);
    if (!Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp) || value.exp <= now || value.iat > now + 120 || value.exp <= value.iat || value.exp - value.iat > LISTENER_ANALYTICS_TOKEN_TTL_SECONDS) return null;
    return value;
  } catch {
    return null;
  }
}

export function normalizeListenerAnalyticsBatch(input, { instant = new Date() } = {}) {
  if (!input || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > LISTENER_ANALYTICS_BATCH_LIMIT) {
    throw new Error(`Send between 1 and ${LISTENER_ANALYTICS_BATCH_LIMIT} listener events.`);
  }
  const now = instant.getTime();
  return input.events.map((event) => {
    if (!CLIENT_EVENT_ID_PATTERN.test(event?.eventId || "")) throw new Error("Each listener event needs a private random event ID.");
    if (!LISTENER_ANALYTICS_EVENT_TYPES.includes(event?.type)) throw new Error("Choose a supported listener event type.");
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new Error("Each listener event needs a valid occurrence time.");
    const age = now - occurredAt.getTime();
    if (age > LISTENER_ANALYTICS_MAX_EVENT_AGE_MS || age < -LISTENER_ANALYTICS_MAX_CLOCK_SKEW_MS) {
      throw new Error("Listener events must be reported close to when they occurred.");
    }
    const listeningSeconds = event.listeningSeconds == null ? 0 : Number(event.listeningSeconds);
    if (!Number.isInteger(listeningSeconds) || listeningSeconds < 0 || listeningSeconds > 60) {
      throw new Error("Listening time must be a whole number from 0 to 60 seconds.");
    }
    return { clientEventId: event.eventId, eventType: event.type, occurredAt, listeningSeconds };
  });
}

export function listenerAnalyticsHourBucket(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A valid listener event time is required.");
  date.setUTCMinutes(0, 0, 0);
  return date;
}

export function aggregateListenerAnalyticsEvents(events, { organisationId, channelId, channelName, bucketStart } = {}) {
  const sessions = new Set();
  const result = {
    organisationId,
    channelId,
    channelName,
    bucketStart: listenerAnalyticsHourBucket(bucketStart || events[0]?.occurredAt),
    sessionCount: 0,
    sessionStartedCount: 0,
    sessionEndedCount: 0,
    heartbeatCount: 0,
    playbackErrorCount: 0,
    listeningSeconds: 0,
    lastEventReceivedAt: null
  };
  for (const event of events) {
    if (event.sessionHash) sessions.add(event.sessionHash);
    if (event.eventType === "SESSION_STARTED") result.sessionStartedCount += 1;
    if (event.eventType === "SESSION_ENDED") result.sessionEndedCount += 1;
    if (event.eventType === "HEARTBEAT") result.heartbeatCount += 1;
    if (event.eventType === "PLAYBACK_ERROR") result.playbackErrorCount += 1;
    result.listeningSeconds += Math.max(0, Number(event.listeningSeconds) || 0);
    if (!result.lastEventReceivedAt || new Date(event.receivedAt) > result.lastEventReceivedAt) result.lastEventReceivedAt = new Date(event.receivedAt);
  }
  result.sessionCount = sessions.size;
  return result;
}

function isoDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) throw new Error("Dates must use YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Choose a valid calendar date.");
  return date;
}

export function normalizeListenerAnalyticsFilters(input = {}, instant = new Date()) {
  if (input.from || input.to) {
    const fromDate = isoDay(input.from);
    const toDate = isoDay(input.to);
    const days = Math.floor((toDate - fromDate) / 86_400_000) + 1;
    if (days < 1) throw new Error("The report end date must be on or after the start date.");
    if (days > LISTENER_ANALYTICS_MAX_REPORT_DAYS) throw new Error(`Listener analytics reports are limited to ${LISTENER_ANALYTICS_MAX_REPORT_DAYS} days.`);
    return { from: input.from, to: input.to, days };
  }
  const requestedDays = Number(input.days || 30);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const toDate = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
  const fromDate = new Date(toDate.getTime() - (days - 1) * 86_400_000);
  return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10), days };
}

export function buildListenerAnalyticsReport(rows, filters) {
  const daily = new Map();
  const channels = new Map();
  const hourly = new Map();
  const start = isoDay(filters.from);
  for (let offset = 0; offset < filters.days; offset += 1) {
    const date = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    daily.set(date, { date, sessionStarts: 0, listenerHours: 0, playbackErrors: 0, hourlySessions: 0 });
  }
  let totalListeningSeconds = 0;
  let sessionStarts = 0;
  let playbackErrors = 0;
  for (const row of rows) {
    const date = new Date(row.bucketStart).toISOString().slice(0, 10);
    const day = daily.get(date);
    if (!day) continue;
    const seconds = Number(row.listeningSeconds) || 0;
    day.sessionStarts += row.sessionStartedCount;
    day.listenerHours += seconds / 3600;
    day.playbackErrors += row.playbackErrorCount;
    day.hourlySessions += row.sessionCount;
    sessionStarts += row.sessionStartedCount;
    totalListeningSeconds += seconds;
    playbackErrors += row.playbackErrorCount;
    const hourKey = new Date(row.bucketStart).toISOString();
    hourly.set(hourKey, (hourly.get(hourKey) || 0) + row.sessionCount);
    const channel = channels.get(row.channelId) || { id: row.channelId, name: row.channelName, sessionStarts: 0, listenerHours: 0, playbackErrors: 0, peakHourlyListeners: 0 };
    channel.sessionStarts += row.sessionStartedCount;
    channel.listenerHours += seconds / 3600;
    channel.playbackErrors += row.playbackErrorCount;
    channel.peakHourlyListeners = Math.max(channel.peakHourlyListeners, row.sessionCount);
    channels.set(row.channelId, channel);
  }
  const averageListeningMinutes = sessionStarts ? totalListeningSeconds / 60 / sessionStarts : 0;
  return {
    filters,
    totals: {
      sessionStarts,
      listenerHours: totalListeningSeconds / 3600,
      averageListeningMinutes,
      playbackErrors,
      peakHourlyListeners: Math.max(0, ...hourly.values())
    },
    days: [...daily.values()],
    channels: [...channels.values()].sort((left, right) => right.listenerHours - left.listenerHours || left.name.localeCompare(right.name)),
    privacy: {
      storesPersonalIdentity: false,
      storesIpAddress: false,
      rawRetentionDays: LISTENER_ANALYTICS_RAW_RETENTION_DAYS,
      aggregateRetentionDays: LISTENER_ANALYTICS_AGGREGATE_RETENTION_DAYS,
      notice: "Audience figures represent privacy-preserving anonymous listening sessions, not identified people. Hourly totals may count a long session in more than one hour."
    }
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function listenerAnalyticsCsv(report) {
  const rows = [
    ["Ruvanas listener analytics"],
    ["Period", report.filters.from, report.filters.to],
    ["Privacy", "Anonymous sessions; no names, email addresses, raw IP addresses or user-agent strings"],
    [],
    ["UTC day", "Session starts", "Listener hours", "Playback errors", "Hourly session observations"],
    ...report.days.map((day) => [day.date, day.sessionStarts, day.listenerHours.toFixed(2), day.playbackErrors, day.hourlySessions]),
    [],
    ["Channel", "Session starts", "Listener hours", "Playback errors", "Peak listeners in one hour"],
    ...report.channels.map((channel) => [channel.name, channel.sessionStarts, channel.listenerHours.toFixed(2), channel.playbackErrors, channel.peakHourlyListeners])
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
