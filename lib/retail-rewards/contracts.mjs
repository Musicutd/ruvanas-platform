import { z } from "zod";

// Policy projections only. Parsing one of these values does not issue a grant,
// authenticate its source or establish that the underlying records are current.
export const REWARDS_ACTIONS = Object.freeze([
  "READ", "MANAGE_OFFERS", "PUBLISH_OFFERS", "REDEEM", "REVERSE",
  "VIEW_INSIGHTS", "EXPORT", "MANAGE_STAFF"
]);

export const rewardActionSchema = z.enum(REWARDS_ACTIONS);
export const rewardIdSchema = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const dateSchema = z.date().refine(value => Number.isFinite(value.getTime()));
const limitSchema = z.number().int().nonnegative().max(1_000_000_000);

export const rewardLimitsSchema = z.object({
  activeOffers: limitSchema,
  locations: limitSchema,
  staffSeats: limitSchema,
  monthlyRedemptions: limitSchema,
  analyticsRetentionDays: limitSchema,
  exportEnabled: z.boolean(),
  brandingEnabled: z.boolean()
}).strict();

export const rewardGrantSchema = z.object({
  id: rewardIdSchema,
  organisationId: rewardIdSchema,
  subscriptionId: rewardIdSchema,
  capability: z.literal("RETAIL_REWARDS"),
  source: z.literal("MANUAL_INTERNAL"),
  tier: z.enum(["REWARDS_STARTER", "REWARDS_PRO", "REWARDS_BUSINESS", "REWARDS_ENTERPRISE"]),
  status: z.enum(["DISABLED", "TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"]),
  startsAt: dateSchema,
  expiresAt: dateSchema,
  revokedAt: dateSchema.nullable(),
  limits: rewardLimitsSchema
}).strict().refine(value => value.startsAt < value.expiresAt, {
  path: ["expiresAt"], message: "Expiry must follow the start."
});

export const rewardProgramSchema = z.object({
  id: rewardIdSchema,
  organisationId: rewardIdSchema,
  status: z.enum(["DISABLED", "ACTIVE", "PAUSED"])
}).strict();

export const rewardStaffGrantSchema = z.object({
  id: rewardIdSchema,
  organisationId: rewardIdSchema,
  organisationMemberId: rewardIdSchema,
  capabilities: z.array(rewardActionSchema).min(1).max(REWARDS_ACTIONS.length)
    .refine(values => new Set(values).size === values.length, "Capabilities must be unique."),
  scope: z.enum(["ALL_LOCATIONS", "LOCATIONS"]),
  locationIds: z.array(rewardIdSchema).max(500)
    .refine(values => new Set(values).size === values.length, "Locations must be unique."),
  startsAt: dateSchema,
  expiresAt: dateSchema,
  revokedAt: dateSchema.nullable()
}).strict().refine(value => value.startsAt < value.expiresAt, {
  path: ["expiresAt"], message: "Expiry must follow the start."
}).refine(value => value.scope === "ALL_LOCATIONS"
  ? value.locationIds.length === 0
  : value.locationIds.length > 0, {
  path: ["locationIds"], message: "Location IDs must match the explicit scope."
});
