export const SCHOOL_PUBLICATION_REPORT_MAX_DAYS = 93;
export const SCHOOL_PUBLICATION_REPORT_DEFAULT_DAYS = 30;
export const SCHOOL_PUBLICATION_EVIDENCE_NOTICE = "Aggregate origin-delivery evidence only. It does not identify listeners, students, devices, plays, completion, reach, or audience size.";

const DAY_MS = 86_400_000;

function dateOnly(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a calendar date.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a valid calendar date.`);
  return date;
}

export function schoolPublicationDayBucket(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Publication evidence timestamps must be valid dates.");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function normaliseSchoolPublicationFilters(input = {}, now = new Date()) {
  const to = input.to || now.toISOString().slice(0, 10);
  const defaultFrom = new Date(`${to}T00:00:00.000Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - (SCHOOL_PUBLICATION_REPORT_DEFAULT_DAYS - 1));
  const from = input.from || defaultFrom.toISOString().slice(0, 10);
  const fromDate = dateOnly(from, "From");
  const toDate = dateOnly(to, "To");
  if (fromDate > toDate) throw new Error("From must not be after To.");
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  if (days > SCHOOL_PUBLICATION_REPORT_MAX_DAYS) throw new Error(`School publication evidence is limited to ${SCHOOL_PUBLICATION_REPORT_MAX_DAYS} days.`);
  const until = new Date(toDate);
  until.setUTCDate(until.getUTCDate() + 1);
  return { from, to, days, fromInstant: fromDate, until };
}

function retentionDays(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function schoolPublicationRetentionPreview(readiness = {}, now = new Date()) {
  const rawRecordingRetentionDays = retentionDays(readiness.rawRecordingRetentionDays);
  const consentEvidenceRetentionDays = retentionDays(readiness.consentEvidenceRetentionDays);
  const cutoff = (days) => days ? new Date(now.getTime() - days * DAY_MS).toISOString() : null;
  return Object.freeze({
    readinessStatus: readiness.status || "NOT_CONFIGURED",
    rawRecordingRetentionDays,
    rawRecordingCutoff: cutoff(rawRecordingRetentionDays),
    consentEvidenceRetentionDays,
    consentEvidenceCutoff: cutoff(consentEvidenceRetentionDays),
    previewOnly: true,
    destructiveActionPerformed: false
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function schoolPublicationEvidenceCsv(report) {
  const headers = [
    "UTC day", "Episode", "Series", "Metadata listings", "Audio delivery requests",
    "Full audio requests", "Range audio requests", "Audio bytes offered",
    "Evidence basis", "Listener or audience measured"
  ];
  const rows = (report.episodes || []).flatMap((episode) => (episode.days || []).map((day) => [
    day.date,
    episode.title,
    episode.series,
    day.metadataListingCount,
    day.audioRequestCount,
    day.fullAudioRequestCount,
    day.rangeAudioRequestCount,
    day.audioBytesOffered,
    "Aggregate origin-delivery evidence",
    "No"
  ]));
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
