import { z } from "zod";
import { rewardIdSchema, rewardLimitsSchema } from "./contracts.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
import { publicSlugSchema } from "./shopper-contracts.mjs";
import { canonicalEmailSchema } from "./shopper-auth-contracts.mjs";

const OFF = Object.freeze({ enabled: false, valid: false, organisationIds: Object.freeze([]) });
const allowlistSchema = z.array(rewardIdSchema).min(1).max(10).refine(ids => new Set(ids).size === ids.length);
export function readPilotAdminPolicy(env = {}) {
  try {
    const parent = readRewardsFeaturePolicy(env), flag = env.RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED;
    if (!parent.valid || ![undefined, "false", "true"].includes(flag)) return OFF;
    if (flag !== "true") return Object.freeze({ enabled: false, valid: true, organisationIds: Object.freeze([]) });
    const raw = env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS;
    if (typeof raw !== "string" || raw.length > 2048) return OFF;
    const ids = allowlistSchema.safeParse(JSON.parse(raw));
    if (!ids.success) return OFF;
    return Object.freeze({ enabled: parent.enabled, valid: true, organisationIds: Object.freeze([...ids.data].sort()) });
  } catch { return OFF; }
}

const text = (min, max) => z.string().trim().min(min).max(max).refine(value => value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value));
const isoDate = z.iso.datetime({ offset: false }).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const organisation = z.object({ organisationId: rewardIdSchema }).strict();
export const pilotAdminSchemas = Object.freeze({
  organisations: z.object({}).strict(),
  overview: organisation,
  readiness: organisation,
  prepare: organisation.extend({ expiresAt: isoDate,
    tier: z.enum(["REWARDS_STARTER", "REWARDS_PRO", "REWARDS_BUSINESS", "REWARDS_ENTERPRISE"]), limits: rewardLimitsSchema }).strict(),
  publishShop: organisation.extend({ locationId: rewardIdSchema, publicSlug: publicSlugSchema, displayName: text(1, 140),
    description: text(0, 2000), locality: text(1, 120), countryCode: z.string().regex(/^[A-Z]{2}$/), confirm: z.literal(true) }).strict(),
  approveOffer: organisation.extend({ offerId: rewardIdSchema, revision: z.number().int().positive().max(2_147_483_647),
    publicSlug: publicSlugSchema, confirm: z.literal(true) }).strict(),
  invite: organisation.extend({ email: canonicalEmailSchema, displayName: text(1, 80), expiresAt: isoDate, confirm: z.literal(true) }).strict(),
  reissue: organisation.extend({ shopperId: rewardIdSchema, confirm: z.literal(true) }).strict(),
  revoke: organisation.extend({ shopperId: rewardIdSchema, confirm: z.literal(true) }).strict()
});
