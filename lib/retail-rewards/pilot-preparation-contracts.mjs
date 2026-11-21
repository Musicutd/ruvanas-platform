import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { pilotReadinessSchema } from "./pilot-readiness-contracts.mjs";

const count = z.number().int().min(0).max(100);
const iso = z.string().refine(value => { const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value; });
export const pilotPreparationInputSchema = z.object({ organisationId: rewardIdSchema }).strict();
const preparedShoppers = z.object({ total: count, disabled: count, active: count, suspended: count,
  enrolled: count, expiredMemberships: count, revokedInvitations: count }).strict().refine(value =>
  value.total > 0 && value.disabled + value.active + value.suspended === value.total && value.enrolled <= value.total &&
  value.expiredMemberships <= value.enrolled && value.revokedInvitations <= value.enrolled);
export const pilotPreparationSchema = z.object({
  ok: z.literal(true), mode: z.literal("READ_ONLY_PREPARATION"), rewardsEnabled: z.literal(false),
  organisation: z.object({ id: rewardIdSchema, name: z.string().min(1).max(500) }).strict(),
  readiness: pilotReadinessSchema, preparedShoppers, grantExpiresAt: iso, checkedAt: iso,
  endToEndTest: z.literal("NOT_VERIFIED")
}).strict().refine(value => value.organisation.id === value.readiness.organisation.id &&
  value.organisation.name === value.readiness.organisation.name && value.checkedAt === value.readiness.checkedAt &&
  value.readiness.eligibleNow === false && value.readiness.checks[0].status !== "READY");

// A snapshot describes stored configuration only. It is never an access grant,
// an invitation, a renewal fingerprint, or proof of a successful sign-in.
export function safePilotPreparationSnapshot(value, organisationId) {
  const result = pilotPreparationSchema.safeParse(value);
  return result.success && result.data.organisation.id === organisationId ? result.data : null;
}

const ERRORS = Object.freeze({
  AUTH_REQUIRED: [401, "Sign in with your Ruvanas Super Admin account."],
  FORBIDDEN: [403, "This preparation view requires your Ruvanas Super Admin account."],
  INVALID_REQUEST: [400, "Choose one prepared test workspace."],
  PREPARATION_UNAVAILABLE: [409, "Read-only preparation is unavailable for this workspace or configuration."],
  REVIEW_TOO_LARGE: [409, "This preparation snapshot exceeds the supported review size."],
  UNAVAILABLE: [503, "The saved preparation could not be checked. Try again later."]
});
export function pilotPreparationDenied(code) {
  const key = Object.hasOwn(ERRORS, code) ? code : "UNAVAILABLE";
  const [status, error] = ERRORS[key];
  return { ok: false, code: key, status, error };
}
