import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
export function readCampaignReviewPolicy(env = {}) {
  try {
    const parent = readRewardsFeaturePolicy(env), flag = env.RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED;
    if (!parent.valid || ![undefined, "false", "true"].includes(flag)) return { enabled: false, valid: false };
    return { enabled: parent.enabled && flag === "true", valid: true };
  } catch { return { enabled: false, valid: false }; }
}
const page = z.preprocess(value => typeof value === "string" && /^[1-9]\d{0,3}$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(1000)).optional();
export const campaignOffersQuerySchema = z.object({ page }).strict();
export const campaignReviewQuerySchema = z.object({ offerId: rewardIdSchema, revision: z.number().int().min(1).max(2147483647), page }).strict();
