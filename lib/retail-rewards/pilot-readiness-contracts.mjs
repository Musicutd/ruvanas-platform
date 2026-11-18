import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
export const PILOT_READINESS_KEYS = Object.freeze(["environment", "owner", "entitlement", "shops", "coupons", "cashiers", "shoppers"]);
export const PILOT_READINESS_CODES = Object.freeze({
  environment: Object.freeze(["ENVIRONMENT_COMPATIBLE", "PRIVATE_PREVIEW_BLOCKED", "ENVIRONMENT_INVALID", "FEATURES_DISABLED", "AUTH_CONFIGURATION_UNAVAILABLE"]),
  owner: Object.freeze(["OWNER_READY", "OWNER_MISSING"]),
  entitlement: Object.freeze(["ENTITLEMENT_READY", "ENTITLEMENT_MISSING", "ENTITLEMENT_INACTIVE"]),
  shops: Object.freeze(["SHOPS_READY", "SHOPS_MISSING", "SHOPS_INACTIVE"]),
  coupons: Object.freeze(["COUPONS_READY", "COUPONS_MISSING", "COUPONS_NOT_APPROVED", "COUPONS_INACTIVE"]),
  cashiers: Object.freeze(["CASHIERS_READY", "CASHIERS_MISSING", "CASHIERS_INACTIVE"]),
  shoppers: Object.freeze(["SHOPPERS_READY", "SHOPPERS_MISSING", "SHOPPERS_INACTIVE"])
});
const count = z.number().int().min(0).max(100);
const expectedStatus = code => code === "ENVIRONMENT_COMPATIBLE" || code.endsWith("_READY") ? "READY"
  : code.endsWith("_MISSING") || code === "COUPONS_NOT_APPROVED" ? "MISSING" : "BLOCKED";
const check = z.object({ key: z.enum(PILOT_READINESS_KEYS), status: z.enum(["READY", "BLOCKED", "MISSING"]),
  code: z.string(), configuredCount: count, eligibleCount: count }).strict().refine(row =>
  PILOT_READINESS_CODES[row.key].includes(row.code) && row.eligibleCount <= row.configuredCount &&
  (row.key !== "environment" || row.configuredCount <= 1) &&
  row.status === expectedStatus(row.code) && (row.status !== "MISSING" || row.configuredCount === 0) &&
  (row.status === "READY" ? row.eligibleCount > 0 : row.eligibleCount === 0));
export const pilotReadinessSchema = z.object({ ok: z.literal(true), organisation: z.object({ id: rewardIdSchema, name: z.string().min(1).max(500) }).strict(),
  configured: z.boolean(), eligibleNow: z.boolean(), endToEndTest: z.literal("NOT_VERIFIED"),
  checks: z.array(check).length(7), pendingInvitations: count,
  checkedAt: z.string().refine(value => { const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value; })
}).strict().refine(value => value.checks.every((row, index) => row.key === PILOT_READINESS_KEYS[index]) &&
  value.configured === value.checks.slice(1).every(row => row.configuredCount > 0) &&
  value.eligibleNow === value.checks.every(row => row.eligibleCount > 0));
