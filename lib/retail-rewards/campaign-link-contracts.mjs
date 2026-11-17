import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readCampaignReviewPolicy } from "./campaign-review-contracts.mjs";

export function readCampaignLinkPolicy(env = {}) {
  try {
    const parent = readCampaignReviewPolicy(env), flag = env.RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED;
    if (!parent.valid || ![undefined, "false", "true"].includes(flag)) return { enabled: false, valid: false };
    return { enabled: parent.enabled && flag === "true", valid: true };
  } catch { return { enabled: false, valid: false }; }
}
const version = z.number().int().min(1).max(2147483647);
export const campaignLinkReviewSchema = z.object({ offerId: rewardIdSchema, expectedVersion: version,
  page: z.number().int().min(1).max(1000).optional() }).strict();
export const campaignLinkSaveSchema = z.object({ offerId: rewardIdSchema, expectedVersion: version,
  campaignId: rewardIdSchema.nullable(), campaignPublicationRevision: version.optional() }).strict()
  .refine(value => value.campaignId === null ? value.campaignPublicationRevision === undefined : value.campaignPublicationRevision !== undefined);
