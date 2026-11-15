import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";

const OFF = Object.freeze({ enabled: false, valid: false });
export const REPORT_PAGE_SIZE = 25;
export const REPORT_MAX_ROWS = 1000;
export const REPORT_MAX_RANGE_DAYS = 31;
export const REPORT_MAX_AGE_MS = 15 * 60 * 1000;
export const reportViewSchema = z.enum(["CLAIMS", "REDEMPTIONS"]);

// Reporting may remain available while checkout is disabled. It never enables
// checkout, public claims, registrations, billing or any other product.
export function readReportsPolicy(env = {}) {
  try {
    const parent = readRewardsFeaturePolicy(env), flag = env?.RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED;
    if (!parent.valid || ![undefined, "false", "true"].includes(flag)) return OFF;
    return Object.freeze({ enabled: parent.enabled && flag === "true", valid: true });
  } catch { return OFF; }
}

export const reportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  if (value < "1970-01-01") return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const pageSchema = z.preprocess(value => typeof value === "string" && /^[1-9]\d{0,3}$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(1000)).optional();
const asOfSchema = z.string().refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}).optional();
export const reportLocationsSchema = z.object({ page: pageSchema }).strict();
export const reportExportSchema = z.object({
  locationId: rewardIdSchema, fromDate: reportDateSchema, toDate: reportDateSchema, asOf: asOfSchema,
  view: reportViewSchema.default("REDEMPTIONS")
}).strict();
export const reportQuerySchema = reportExportSchema.extend({ page: pageSchema }).strict();
