import crypto from "node:crypto";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const CODE = /^[A-Z0-9_-]{2,24}$/;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const ISWC = /^T\d{10}$/;
const MAX_DAYS = 366;

function clean(value, maximum = 200) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length > maximum) throw new Error(`Text must be ${maximum} characters or fewer.`);
  return text;
}

function dateOnly(value, label) {
  const text = String(value || "").trim();
  if (!DATE.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) throw new Error(`${label} is invalid.`);
  return { text, date };
}

function list(value, label) {
  const entries = Array.isArray(value) ? value : String(value || "").split(",");
  const result = [...new Set(entries.map((item) => clean(item, 160)).filter(Boolean))].slice(0, 50);
  if (result.some((item) => item.length < 2)) throw new Error(`${label} entries need at least two characters.`);
  return result;
}

export function normaliseRightsAuthority(input = {}) {
  const code = clean(input.code, 24).toUpperCase();
  const name = clean(input.name, 160);
  const territoryCode = String(input.territoryCode || "").trim().toUpperCase();
  const reportFormat = ["STANDARD_USAGE_V1", "SUMMARY_USAGE_V1"].includes(input.reportFormat) ? input.reportFormat : "STANDARD_USAGE_V1";
  if (!CODE.test(code)) throw new Error("Authority code must use 2–24 letters, numbers, hyphens or underscores.");
  if (name.length < 2) throw new Error("Authority name is required.");
  if (!COUNTRY.test(territoryCode)) throw new Error("Territory must be a two-letter country code.");
  return { code, name, territoryCode, reportFormat, active: input.active !== false };
}

export function normaliseRightsWorkMapping(input = {}, track = {}) {
  const recordingCode = clean(input.recordingCode, 24).replaceAll("-", "").toUpperCase() || null;
  const workCode = clean(input.workCode, 24).replace(/[.\s-]/g, "").toUpperCase() || null;
  if (recordingCode && !ISRC.test(recordingCode)) throw new Error("Recording code must be a valid 12-character ISRC.");
  if (workCode && !ISWC.test(workCode)) throw new Error("Work code must be a valid ISWC, for example T1234567890.");
  if (!recordingCode && !workCode) throw new Error("Add an ISRC or ISWC before saving a work mapping.");
  const title = clean(input.title || track.title, 240);
  const primaryArtist = clean(input.primaryArtist || track.artist, 240);
  if (!title || !primaryArtist) throw new Error("Track title and primary artist are required.");
  return {
    recordingCode,
    workCode,
    title,
    primaryArtist,
    composers: list(input.composers, "Composer"),
    publishers: list(input.publishers, "Publisher"),
    authorityReference: clean(input.authorityReference, 240) || null,
    verified: Boolean(input.verified)
  };
}

export function defaultRightsReportDates(now = new Date()) {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(`${to}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to };
}

export function normaliseRightsReportFilters(input = {}, now = new Date()) {
  const defaults = defaultRightsReportDates(now);
  const from = dateOnly(input.from || defaults.from, "From date");
  const to = dateOnly(input.to || defaults.to, "To date");
  const days = Math.round((to.date - from.date) / 86_400_000) + 1;
  if (days < 1) throw new Error("The from date must not be after the to date.");
  if (days > MAX_DAYS) throw new Error(`Rights reports are limited to ${MAX_DAYS} days.`);
  const authorityId = clean(input.authorityId, 64);
  if (!authorityId || !/^[A-Za-z0-9_-]+$/.test(authorityId)) throw new Error("Choose a reporting authority.");
  if (input.attestationAccepted !== true) throw new Error("Confirm the report attestation before generating an export.");
  return { from: from.text, to: to.text, authorityId, attestationAccepted: true };
}

export function rightsReportWindow(filters) {
  const from = new Date(`${filters.from}T00:00:00.000Z`);
  const until = new Date(`${filters.to}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  return { from, until };
}

export function rightsEvidenceHash(event) {
  const canonical = [event.sourceProofEventId, event.sourceClientEventId, event.organisationId, event.playerId, event.stationId || "", event.channelId || "", event.trackId, event.mediaAssetId, new Date(event.occurredAt).toISOString(), event.durationSeconds, event.territoryCode, event.rightsUse, event.trackTitle, event.trackArtist, event.rightsReference || ""].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function aggregateRightsUsage({ authority, events = [], mappings = [] }) {
  const mappingByTrack = new Map(mappings.map((mapping) => [mapping.trackId, mapping]));
  const summaryFormat = authority.reportFormat === "SUMMARY_USAGE_V1";
  const grouped = new Map();
  let unmappedEvents = 0;
  let durationSeconds = 0;
  for (const event of events) {
    const mapping = mappingByTrack.get(event.trackId) || null;
    if (!mapping?.recordingCode && !mapping?.workCode) unmappedEvents += 1;
    durationSeconds += event.durationSeconds;
    const date = new Date(event.occurredAt).toISOString().slice(0, 10);
    const key = summaryFormat ? event.trackId : [event.trackId, event.stationId || "", event.channelId || "", date].join("|");
    const row = grouped.get(key) || {
      usageDate: summaryFormat ? "" : date,
      stationId: summaryFormat ? null : event.stationId,
      channelId: summaryFormat ? null : event.channelId,
      trackId: event.trackId,
      title: mapping?.title || event.trackTitle,
      primaryArtist: mapping?.primaryArtist || event.trackArtist,
      recordingCode: mapping?.recordingCode || null,
      workCode: mapping?.workCode || null,
      composers: mapping?.composers || [],
      publishers: mapping?.publishers || [],
      authorityReference: mapping?.authorityReference || null,
      rightsHolder: event.rightsHolder,
      rightsReference: event.rightsReference,
      playCount: 0,
      durationSeconds: 0
    };
    row.playCount += 1;
    row.durationSeconds += event.durationSeconds;
    grouped.set(key, row);
  }
  return {
    authority,
    summary: { usageEvents: events.length, durationSeconds, unmappedEvents, mappedEvents: events.length - unmappedEvents, evidenceBasis: "device-confirmed completed music playback", audienceMeasurement: false, royaltyCalculation: false },
    rows: [...grouped.values()].sort((a, b) => a.usageDate.localeCompare(b.usageDate) || a.primaryArtist.localeCompare(b.primaryArtist) || a.title.localeCompare(b.title))
  };
}

function csvCell(value) {
  let text = Array.isArray(value) ? value.join("; ") : (value === null || value === undefined ? "" : String(value));
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function rightsUsageCsv(report) {
  const common = ["Authority code", "Authority name", "Territory", "Format version", "Evidence basis", "Audience measured", "Royalty amount calculated"];
  const detail = ["Usage date", "Station ID", "Channel ID", "Track ID", "Title", "Primary artist", "ISRC", "ISWC", "Composers", "Publishers", "Authority reference", "Rights holder", "Rights reference", "Completed plays", "Played seconds"];
  const lines = [[...common, ...detail].map(csvCell).join(",")];
  for (const row of report.rows) lines.push([
    report.authority.code, report.authority.name, report.authority.territoryCode, report.authority.reportFormat,
    report.summary.evidenceBasis, "No", "No", row.usageDate, row.stationId, row.channelId, row.trackId,
    row.title, row.primaryArtist, row.recordingCode, row.workCode, row.composers, row.publishers,
    row.authorityReference, row.rightsHolder, row.rightsReference, row.playCount, row.durationSeconds
  ].map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export const RIGHTS_REPORT_ATTESTATION = "I attest that this export reflects Ruvanas device-confirmed completed music usage for the selected organisation, authority and period. It is not an audience measurement or an automatic royalty calculation.";
