import { z } from "zod";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
import { REWARD_CATEGORIES, offerTermsSchema } from "./offer-contracts.mjs";

const OFF = Object.freeze({ enabled: false, valid: false, claimsEnabled: false });
export function readShopperFeaturePolicy(env = {}) {
  try {
    const parent = readRewardsFeaturePolicy(env);
    const value = env?.RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED;
    if (!parent.valid || ![undefined, "false", "true"].includes(value)) return OFF;
    return Object.freeze({ enabled: parent.enabled && value === "true", valid: true, claimsEnabled: false });
  } catch { return OFF; }
}

export const publicSlugSchema = z.string().min(3).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const shopperBrowseSchema = z.object({
  category: z.enum(REWARD_CATEGORIES.map(category => category.value)).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(1000).optional()
}).strict();

// Project only validated immutable consumer terms. Location IDs and all
// database/admin fields are deliberately absent; the selected public shop
// identifies where the displayed offer applies. Never use an admin offer DTO.
export function shopperOfferTerms(input) {
  const parsed = offerTermsSchema.safeParse(input);
  if (!parsed.success) return null;
  const t = parsed.data;
  return {
    schemaVersion: t.schemaVersion, title: t.title, description: t.description, category: t.category,
    type: t.type, percentBps: t.percentBps, amountMinor: t.amountMinor,
    buyQuantity: t.buyQuantity, getQuantity: t.getQuantity, currency: t.currency,
    minimumSpendMinor: t.minimumSpendMinor, exclusions: t.exclusions, legalTerms: t.legalTerms,
    combinable: t.combinable, startsAt: t.startsAt, endsAt: t.endsAt, timezone: t.timezone,
    usage: t.usage, totalLimit: t.totalLimit, perShopperLimit: t.perShopperLimit,
    perShopperDailyLimit: t.perShopperDailyLimit, pausedClaimsPolicy: t.pausedClaimsPolicy
  };
}
