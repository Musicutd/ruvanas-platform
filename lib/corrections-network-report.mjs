export const CORRECTIONS_NETWORK_REPORT_SOURCES = Object.freeze([
  "CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL", "CORRECTIONS_SYNDICATED", "CORRECTIONS_CENTRAL_REHAB",
  "CORRECTIONS_LOCAL_REHAB", "CORRECTIONS_CENTRAL_ANNOUNCE",
  "CORRECTIONS_REHABILITATION", "CORRECTIONS_STANDARD", "CORRECTIONS_PRIORITY",
  "CORRECTIONS_EMERGENCY", "CORRECTIONS_REQUEST"
]);

export const CORRECTIONS_NETWORK_REPORT_KINDS = Object.freeze({
  PROGRAMME: ["CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL", "CORRECTIONS_SYNDICATED"],
  REHABILITATION: ["CORRECTIONS_CENTRAL_REHAB", "CORRECTIONS_LOCAL_REHAB", "CORRECTIONS_REHABILITATION"],
  ANNOUNCEMENT: ["CORRECTIONS_CENTRAL_ANNOUNCE", "CORRECTIONS_STANDARD", "CORRECTIONS_PRIORITY", "CORRECTIONS_EMERGENCY"],
  REQUEST: ["CORRECTIONS_REQUEST"]
});

export function correctionsNetworkReportClassification(source) {
  if (source === "CORRECTIONS_CENTRAL" || source === "CORRECTIONS_CENTRAL_REHAB" || source === "CORRECTIONS_CENTRAL_ANNOUNCE") return "CENTRAL";
  if (source === "CORRECTIONS_SYNDICATED") return "SYNDICATED";
  if (source === "CORRECTIONS_LOCAL" || source === "CORRECTIONS_LOCAL_REHAB") return "LOCAL";
  return "FACILITY";
}

export function correctionsNetworkReportKind(source) {
  return Object.entries(CORRECTIONS_NETWORK_REPORT_KINDS).find(([, sources]) => sources.includes(source))?.[0] || null;
}

function reportDate(value, label) {
  const text = String(value || "");
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return text;
}

export function normaliseCorrectionsNetworkReportFilters(input = {}, now = new Date()) {
  const to = reportDate(input.to || now.toISOString().slice(0, 10), "End date");
  const fromDefault = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const from = reportDate(input.from || fromDefault, "Start date");
  const fromInstant = new Date(`${from}T00:00:00.000Z`);
  const until = new Date(`${to}T00:00:00.000Z`); until.setUTCDate(until.getUTCDate() + 1);
  if (until <= fromInstant || until.getTime() - fromInstant.getTime() > 93 * 86_400_000) throw new Error("Choose a date range of 93 days or fewer.");
  const facilityId = String(input.facilityId || "").trim() || null;
  const groupId = String(input.groupId || "").trim() || null;
  const source = String(input.source || "").trim().toUpperCase() || null;
  const status = String(input.status || "").trim().toUpperCase() || null;
  const classification = String(input.classification || "").trim().toUpperCase() || null;
  const kind = String(input.kind || "").trim().toUpperCase() || null;
  const programmeId = String(input.programmeId || "").trim() || null;
  const rehabilitationId = String(input.rehabilitationId || "").trim() || null;
  const announcementId = String(input.announcementId || "").trim() || null;
  if (facilityId && groupId) throw new Error("Choose a facility or a group, not both.");
  if (source && !CORRECTIONS_NETWORK_REPORT_SOURCES.includes(source)) throw new Error("Choose a valid private delivery source.");
  if (status && !["STARTED", "COMPLETED", "FAILED", "INTERRUPTED"].includes(status)) throw new Error("Choose a valid delivery status.");
  if (classification && !["CENTRAL", "LOCAL", "FACILITY", "SYNDICATED"].includes(classification)) throw new Error("Choose a valid private delivery classification.");
  if (kind && !CORRECTIONS_NETWORK_REPORT_KINDS[kind]) throw new Error("Choose a valid private content type.");
  if ([programmeId, rehabilitationId, announcementId].filter(Boolean).length > 1) throw new Error("Choose only one exact content filter.");
  if ([programmeId, rehabilitationId, announcementId].some((id) => id && (id.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(id)))) throw new Error("Choose a valid content reference.");
  if ((programmeId && kind && kind !== "PROGRAMME") || (rehabilitationId && kind && kind !== "REHABILITATION") ||
      (announcementId && kind && kind !== "ANNOUNCEMENT")) throw new Error("The exact content filter does not match the content type.");
  const allowedSources = CORRECTIONS_NETWORK_REPORT_SOURCES.filter((value) =>
    (!kind || CORRECTIONS_NETWORK_REPORT_KINDS[kind].includes(value)) &&
    (!classification || correctionsNetworkReportClassification(value) === classification));
  if (source && !allowedSources.includes(source)) throw new Error("The source does not match the other report filters.");
  return { from, to, fromInstant, until, facilityId, groupId, source, status, classification, kind,
    programmeId, rehabilitationId, announcementId, allowedSources };
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function correctionsNetworkReportCsv(rows = []) {
  const columns = ["occurredAt", "facility", "facilityId", "classification", "kind", "source", "status",
    "proofEventId", "playoutIntentId", "sourceRevision", "programmeId", "submissionId", "rehabilitationId", "announcementId"];
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n") + "\r\n";
}
