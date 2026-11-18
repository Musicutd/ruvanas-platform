import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { reportDateSchema, reportViewSchema, REPORT_MAX_ROWS, REPORT_PAGE_SIZE, REPORT_MAX_RANGE_DAYS, REPORT_MAX_AGE_MS } from "./reports-contracts.mjs";
import { REVERSAL_REASONS } from "./reversal-contracts.mjs";
import { localMinuteToUtc } from "../advanced-scheduler.mjs";

const timestamp = z.string().refine(value => {
  const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value;
});
const timezone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});
const name = z.string().min(1).max(500), count = z.number().int().min(0).max(REPORT_MAX_ROWS);
const location = z.object({ id: rewardIdSchema, name }).strict();
const filters = z.object({ fromDate: reportDateSchema, toDate: reportDateSchema, timezone }).strict();
const campaignAssociation = z.object({ campaignName: name, promoName: name, campaignRevision: z.number().int().min(1).max(2147483647) }).strict().nullable();
const claim = z.object({ id: rewardIdSchema, issuedAt: timestamp, offerTitle: z.string().min(1).max(140),
  revision: z.number().int().min(1).max(2147483647), shopName: z.string().min(1).max(140), campaignAssociation }).strict();
const receipt = z.object({ id: rewardIdSchema, redeemedAt: timestamp, offerTitle: z.string().min(1).max(140),
  revision: z.number().int().min(1).max(2147483647), shopName: z.string().min(1).max(140),
  campaignAssociation,
  status: z.enum(["REDEEMED", "CORRECTED"]),
  correction: z.object({ reversedAt: timestamp, reason: z.enum(REVERSAL_REASONS) }).strict().nullable()
}).strict().refine(value => (value.status === "CORRECTED") === (value.correction !== null) &&
  (!value.correction || value.correction.reversedAt >= value.redeemedAt));
const summary = z.object({ issued: count, successfulUses: count, correctedUses: count, netUses: count }).strict()
  .refine(value => value.correctedUses <= value.successfulUses && value.netUses === value.successfulUses - value.correctedUses);
function validWindow(value) {
  try {
    const from = Date.parse(`${value.filters.fromDate}T12:00:00Z`), to = Date.parse(`${value.filters.toDate}T12:00:00Z`);
    const next = new Date(to + 86400000).toISOString().slice(0, 10);
    return to >= from && (to - from) / 86400000 + 1 <= REPORT_MAX_RANGE_DAYS &&
      localMinuteToUtc(value.filters.fromDate, 0, value.filters.timezone).toISOString() === value.window.fromInclusive &&
      localMinuteToUtc(next, 0, value.filters.timezone).toISOString() === value.window.toExclusive;
  } catch { return false; }
}
const locations = z.object({ ok: z.literal(true), locations: z.array(location.extend({ canExport: z.boolean() }).strict()).max(REPORT_PAGE_SIZE),
  page: z.number().int().min(1).max(1000), hasMore: z.boolean(),
  defaults: z.object({ fromDate: reportDateSchema, toDate: reportDateSchema }).strict(),
  bounds: z.object({ earliestDate: reportDateSchema, latestDate: reportDateSchema, maxRangeDays: z.literal(REPORT_MAX_RANGE_DAYS) }).strict(),
  timezone, checkedAt: timestamp
}).strict().refine(value => new Set(value.locations.map(row => row.id)).size === value.locations.length &&
  (!value.hasMore || value.locations.length === REPORT_PAGE_SIZE) && value.bounds.earliestDate <= value.defaults.fromDate &&
  value.defaults.fromDate <= value.defaults.toDate && value.defaults.toDate <= value.bounds.latestDate);
const report = z.object({ ok: z.literal(true), location, filters,
  window: z.object({ fromInclusive: timestamp, toExclusive: timestamp }).strict(), asOf: timestamp, checkedAt: timestamp,
  summary, view: reportViewSchema, claims: z.array(claim).max(REPORT_MAX_ROWS), receipts: z.array(receipt).max(REPORT_MAX_ROWS), page: z.number().int().min(1).max(1000),
  hasMore: z.boolean(), totalRows: count, exportAllowed: z.boolean()
}).strict().refine(value => {
  const start = Date.parse(value.window.fromInclusive), end = Date.parse(value.window.toExclusive), asOf = Date.parse(value.asOf);
  return validWindow(value) && end > start && start <= asOf && asOf <= Date.parse(value.checkedAt) &&
    Date.parse(value.checkedAt) - asOf <= REPORT_MAX_AGE_MS &&
    (value.view === "CLAIMS" ? value.receipts.length === 0 && value.totalRows === value.summary.issued : value.claims.length === 0 && value.totalRows === value.summary.successfulUses) &&
    new Set(value.claims.map(row => row.id)).size === value.claims.length && value.claims.every(row => {
      const at = Date.parse(row.issuedAt); return at >= start && at < end && at <= asOf;
    }) &&
    value.receipts.filter(row => row.status === "CORRECTED").length <= value.summary.correctedUses &&
    new Set(value.receipts.map(row => row.id)).size === value.receipts.length && value.receipts.every(row => {
      const at = Date.parse(row.redeemedAt); return at >= start && at < end && at <= asOf &&
        (!row.correction || Date.parse(row.correction.reversedAt) <= asOf);
    });
});

export function safeReportingResult(operation, value) {
  const schema = operation === "locations" ? locations : ["report", "exportReport"].includes(operation) ? report : null;
  const parsed = schema?.safeParse(value); if (!parsed?.success) return null;
  const result = parsed.data; if (operation === "locations") return result;
  const rows = result.view === "CLAIMS" ? result.claims : result.receipts;
  if (operation === "exportReport") {
    if (!result.exportAllowed || result.page !== 1 || result.hasMore || rows.length !== result.totalRows ||
      (result.view === "REDEMPTIONS" && result.receipts.filter(row => row.status === "CORRECTED").length !== result.summary.correctedUses)) return null;
  } else {
    const remaining = Math.max(0, result.totalRows - (result.page - 1) * REPORT_PAGE_SIZE);
    if (rows.length !== Math.min(REPORT_PAGE_SIZE, remaining) || result.hasMore !== (remaining > REPORT_PAGE_SIZE)) return null;
  }
  return result;
}
