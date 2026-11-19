import { safeReportingResult } from "./reporting-dtos.mjs";

export const REPORT_CSV_FILENAME = "ruvanas-rewards-receipts.csv";
export const CLAIMS_CSV_FILENAME = "ruvanas-rewards-claims.csv";
export const reportingCsvFilename = view => view === "CLAIMS" ? CLAIMS_CSV_FILENAME : REPORT_CSV_FILENAME;
export const REPORT_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const REPORT_CSV_HEADERS = Object.freeze(["from_date", "to_date", "timezone", "as_of", "receipt_id", "recorded_at",
  "offer", "issued_version", "shop", "status", "corrected_at", "correction_reason", "campaign", "campaign_revision", "promotion"]);
export const CLAIMS_CSV_HEADERS = Object.freeze(["from_date", "to_date", "timezone", "as_of", "claim_id", "issued_at",
  "offer", "issued_version", "shop", "campaign", "campaign_revision", "promotion"]);
function cell(value) {
  // Spreadsheet formulas can be hidden behind whitespace/control characters.
  // Quote every field, remove controls, and neutralise formula-leading text.
  let text = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function buildReportingCsv(value) {
  const report = safeReportingResult("exportReport", value); if (!report) return null;
  const association = row => [row.campaignAssociation?.campaignName, row.campaignAssociation?.campaignRevision, row.campaignAssociation?.promoName];
  const rows = report.view === "CLAIMS" ? [CLAIMS_CSV_HEADERS, ...report.claims.map(row => [report.filters.fromDate, report.filters.toDate,
    report.filters.timezone, report.asOf, row.id, row.issuedAt, row.offerTitle, row.revision, row.shopName, ...association(row)])] :
    [REPORT_CSV_HEADERS, ...report.receipts.map(row => [report.filters.fromDate, report.filters.toDate,
    report.filters.timezone, report.asOf, row.id, row.redeemedAt, row.offerTitle, row.revision, row.shopName, row.status,
    row.correction?.reversedAt, row.correction?.reason, ...association(row)])];
  const csv = rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
  return new TextEncoder().encode(csv).byteLength <= REPORT_CSV_MAX_BYTES ? csv : null;
}
