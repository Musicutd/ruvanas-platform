import { z } from "zod";
import { resolveEffectivePlan, resolveEntitlements } from "../entitlements.mjs";
import { rewardActionSchema, rewardGrantSchema, rewardIdSchema,
  rewardLimitsSchema, rewardProgramSchema } from "./contracts.mjs";

const NOT_ENTITLED = Object.freeze({ allowed: false, code: "NOT_ENTITLED" });
const INVALID_REQUEST = Object.freeze({ allowed: false, code: "INVALID_REQUEST" });
const LIMIT_REACHED = Object.freeze({ allowed: false, code: "LIMIT_REACHED" });
const ALLOWED = Object.freeze({ allowed: true });

const inputSchema = z.object({
  organisationId: rewardIdSchema,
  // Preserve the existing resolver's authenticated test-plan object binding.
  // This is a trusted server-loaded subscription, never request-body authority.
  subscription: z.unknown(),
  grant: rewardGrantSchema,
  program: rewardProgramSchema,
  action: rewardActionSchema,
  now: z.date()
}).strict();

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function booleanOrAbsent(value) {
  return value === undefined || value === null || typeof value === "boolean";
}

function validRetailSubscription(subscription, organisationId, subscriptionId, now) {
  if (!record(subscription) || subscription.id !== subscriptionId ||
    subscription.organisationId !== organisationId ||
    !["ACTIVE", "TRIAL"].includes(subscription.status) ||
    !booleanOrAbsent(subscription.retailRadioEnabled) ||
    !booleanOrAbsent(subscription.complimentaryAccessActive)) return false;

  // The core resolver intentionally supports legacy inputs. Rewards must not
  // turn truthy strings or malformed complimentary flags into Retail access.
  if (subscription.plan != null && (!record(subscription.plan) ||
    typeof subscription.plan.active !== "boolean" ||
    typeof subscription.plan.retailRadioEnabled !== "boolean")) return false;
  if (subscription.complimentaryAccessActive === true &&
    typeof subscription.complimentaryRetailRadioEnabled !== "boolean") return false;

  const plan = resolveEffectivePlan(subscription, now);
  if (!record(plan) || plan.active !== true || typeof plan.retailRadioEnabled !== "boolean") return false;
  const eligibility = resolveEntitlements(subscription, now);
  return eligibility.serviceEnabled === true && eligibility.retailRadioEnabled === true;
}

/** Pure policy only: the caller must independently authenticate, load current
 * records, enforce feature/action/location access and reserve usage atomically.
 * No grant, subscription, program or usage record is created or modified here.
 */
export function resolveRewardsEntitlements(input) {
  try {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return NOT_ENTITLED;
    const { organisationId, subscription, grant, program, action, now } = parsed.data;
    if (grant.organisationId !== organisationId || program.organisationId !== organisationId ||
      program.status !== "ACTIVE" || !["ACTIVE", "TRIAL"].includes(grant.status) ||
      grant.revokedAt !== null || grant.startsAt > now || grant.expiresAt <= now ||
      !validRetailSubscription(subscription, organisationId, grant.subscriptionId, now)) return NOT_ENTITLED;

    const { limits } = grant;
    if ((action === "EXPORT" && !limits.exportEnabled) ||
      (["VIEW_INSIGHTS", "EXPORT"].includes(action) && limits.analyticsRetentionDays === 0) ||
      (action === "PUBLISH_OFFERS" && limits.activeOffers === 0) ||
      (action === "REDEEM" && (limits.monthlyRedemptions === 0 || limits.locations === 0 || limits.staffSeats === 0))) {
      return NOT_ENTITLED;
    }
    return Object.freeze({ allowed: true, tier: grant.tier, limits: Object.freeze({ ...limits }) });
  } catch {
    // Do not expose validation details or exceptions from malformed projections.
    return NOT_ENTITLED;
  }
}

const capacitySchema = z.object({
  limits: rewardLimitsSchema,
  resource: z.enum(["activeOffers", "locations", "staffSeats", "monthlyRedemptions"]),
  used: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  increment: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
}).strict();

/** Advisory arithmetic only, not a reservation or concurrency guarantee. */
export function checkRewardsCapacity(input) {
  try {
    const parsed = capacitySchema.safeParse(input);
    if (!parsed.success) return INVALID_REQUEST;
    const { limits, resource, used, increment = 1 } = parsed.data;
    const limit = limits[resource];
    // Subtraction avoids accepting an overflowing used + increment result.
    return used <= limit && increment <= limit - used ? ALLOWED : LIMIT_REACHED;
  } catch {
    return INVALID_REQUEST;
  }
}
