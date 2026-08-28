import crypto from "node:crypto";

export const OPERATIONAL_ANALYTICS_MAX_DAYS = 93;
export const OPERATIONAL_ANALYTICS_DEFAULT_DAYS = 30;
export const ANALYTICS_EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

const COUNT_FIELDS = Object.freeze([
  "plannedCount",
  "campaignPlannedCount",
  "schoolPlannedCount",
  "playbackStartedCount",
  "playbackCompletedCount",
  "playbackFailedCount",
  "playbackInterruptedCount",
  "musicCompletedCount",
  "promoCompletedCount",
  "schoolCompletedCount",
  "heartbeatCount"
]);

function dateOnly(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a calendar date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date.`);
  }
  return date;
}

export function normaliseOperationalAnalyticsFilters(input = {}, now = new Date()) {
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFromDate = new Date(`${defaultTo}T00:00:00.000Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - (OPERATIONAL_ANALYTICS_DEFAULT_DAYS - 1));
  const from = input.from || defaultFromDate.toISOString().slice(0, 10);
  const to = input.to || defaultTo;
  const fromDate = dateOnly(from, "From");
  const toDate = dateOnly(to, "To");
  if (fromDate > toDate) throw new Error("From must not be after To.");
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days > OPERATIONAL_ANALYTICS_MAX_DAYS) {
    throw new Error(`Operational analytics are limited to ${OPERATIONAL_ANALYTICS_MAX_DAYS} days.`);
  }
  return { from, to, days };
}

export function operationalAnalyticsUtcWindow(filters) {
  const from = new Date(`${filters.from}T00:00:00.000Z`);
  const until = new Date(`${filters.to}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  return { from, until };
}

export function analyticsHourBucket(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Analytics timestamps must be valid dates.");
  date.setUTCMinutes(0, 0, 0);
  return date;
}

function emptyDelta(snapshot, bucketStart) {
  return {
    organisationId: snapshot.organisationId,
    playerId: snapshot.playerId,
    playerName: snapshot.playerName,
    locationId: snapshot.locationId,
    locationName: snapshot.locationName,
    zoneId: snapshot.zoneId,
    zoneName: snapshot.zoneName,
    bucketStart,
    ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0]))
  };
}

function addDelta(map, snapshot, when, changes) {
  const bucketStart = analyticsHourBucket(when);
  const key = `${snapshot.organisationId}:${snapshot.playerId}:${bucketStart.toISOString()}`;
  const current = map.get(key) || emptyDelta(snapshot, bucketStart);
  for (const [field, value] of Object.entries(changes)) current[field] += value;
  map.set(key, current);
}

export function buildOperationalAnalyticsDeltas({ intents = [], events = [] }) {
  const map = new Map();
  for (const intent of intents) {
    const snapshot = {
      organisationId: intent.organisationId,
      playerId: intent.playerId,
      playerName: intent.playerName || intent.player?.name || "Player",
      locationId: intent.locationId,
      locationName: intent.locationName,
      zoneId: intent.zoneId,
      zoneName: intent.zoneName || intent.zone?.name || "Zone"
    };
    addDelta(map, snapshot, intent.plannedStart, {
      plannedCount: 1,
      campaignPlannedCount: intent.campaignId ? 1 : 0,
      schoolPlannedCount: intent.schoolBroadcastSlotId ? 1 : 0
    });
  }
  for (const event of events) {
    const snapshot = {
      organisationId: event.organisationId,
      playerId: event.playerId,
      playerName: event.playerName,
      locationId: event.locationId || event.zone?.locationId,
      locationName: event.locationName,
      zoneId: event.zoneId,
      zoneName: event.zoneName
    };
    const changes = {};
    if (event.eventType === "STARTED") changes.playbackStartedCount = 1;
    if (event.eventType === "COMPLETED") {
      changes.playbackCompletedCount = 1;
      if (event.itemType === "MUSIC") changes.musicCompletedCount = 1;
      if (event.itemType === "PROMO") changes.promoCompletedCount = 1;
      if (event.itemType === "SCHOOL_ANNOUNCEMENT") changes.schoolCompletedCount = 1;
    }
    if (event.eventType === "FAILED") changes.playbackFailedCount = 1;
    if (event.eventType === "INTERRUPTED") changes.playbackInterruptedCount = 1;
    addDelta(map, snapshot, event.occurredAt, changes);
  }
  return [...map.values()];
}

export function operationalAnalyticsSummary(rows = []) {
  const summary = Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0]));
  for (const row of rows) {
    for (const field of COUNT_FIELDS) summary[field] += Number(row[field] || 0);
  }
  summary.confirmationRate = summary.playbackStartedCount > 0
    ? summary.playbackCompletedCount / summary.playbackStartedCount
    : 0;
  return summary;
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function operationalAnalyticsCsv(report) {
  const headers = [
    "UTC day", "Planned", "Started", "Confirmed complete", "Failed", "Interrupted",
    "Music confirmed", "Promotion confirmed", "School confirmed", "Heartbeat samples",
    "Evidence basis", "Audience measured"
  ];
  const rows = report.days.map((day) => [
    day.date,
    day.plannedCount,
    day.playbackStartedCount,
    day.playbackCompletedCount,
    day.playbackFailedCount,
    day.playbackInterruptedCount,
    day.musicCompletedCount,
    day.promoCompletedCount,
    day.schoolCompletedCount,
    day.heartbeatCount,
    "Device-confirmed operational evidence",
    "No"
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function exportTokenPayload({ jobId, organisationId, requestedByUserId, expiresAt }) {
  return `${jobId}:${organisationId}:${requestedByUserId}:${new Date(expiresAt).toISOString()}`;
}

export function signAnalyticsExport(input, secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("An export signing secret of at least 32 characters is required.");
  }
  return crypto.createHmac("sha256", secret).update(exportTokenPayload(input)).digest("hex");
}

export function verifyAnalyticsExport(input, token, secret, now = new Date()) {
  if (new Date(input.expiresAt) <= now || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = signAnalyticsExport(input, secret);
  return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
}
