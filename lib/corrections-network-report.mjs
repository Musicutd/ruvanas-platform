export const CORRECTIONS_NETWORK_REPORT_SOURCES = Object.freeze([
  "CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL", "CORRECTIONS_CENTRAL_REHAB",
  "CORRECTIONS_LOCAL_REHAB", "CORRECTIONS_CENTRAL_ANNOUNCE",
  "CORRECTIONS_REHABILITATION", "CORRECTIONS_STANDARD", "CORRECTIONS_PRIORITY",
  "CORRECTIONS_EMERGENCY", "CORRECTIONS_REQUEST"
]);

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
  if (facilityId && groupId) throw new Error("Choose a facility or a group, not both.");
  if (source && !CORRECTIONS_NETWORK_REPORT_SOURCES.includes(source)) throw new Error("Choose a valid private delivery source.");
  if (status && !["STARTED", "COMPLETED", "FAILED", "INTERRUPTED"].includes(status)) throw new Error("Choose a valid delivery status.");
  return { from, to, fromInstant, until, facilityId, groupId, source, status };
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function correctionsNetworkReportCsv(rows = []) {
  const columns = ["date", "facility", "source", "status", "playerEvents"];
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n") + "\r\n";
}
