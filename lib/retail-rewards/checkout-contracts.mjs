import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readShopperFeaturePolicy, publicSlugSchema } from "./shopper-contracts.mjs";

const OFF = Object.freeze({ enabled: false, valid: false });
export function readCheckoutPolicy(env = {}) {
  try {
    const parent = readShopperFeaturePolicy(env);
    const flag = env?.RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED;
    if (!parent.valid || ![undefined, "false", "true"].includes(flag)) return OFF;
    return Object.freeze({ enabled: parent.enabled && flag === "true", valid: true });
  } catch { return OFF; }
}

export const checkoutTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const checkoutIdempotencySchema = z.uuid().transform(value => value.toLowerCase());
export const createClaimSchema = z.object({
  shopSlug: publicSlugSchema, offerSlug: publicSlugSchema,
  expectedRevision: z.number().int().min(1).max(2_147_483_647),
  idempotencyKey: checkoutIdempotencySchema
}).strict();
export const walletQuerySchema = z.object({ page: z.number().int().min(1).max(1000).optional() }).strict();
export const staffValidateSchema = z.object({ token: checkoutTokenSchema, locationId: rewardIdSchema }).strict();
export const staffRedeemSchema = staffValidateSchema.extend({
  idempotencyKey: checkoutIdempotencySchema,
  eligibleSpendMinor: z.number().int().min(0).max(100_000_000),
  currency: z.enum(["EUR", "USD", "GBP", "CAD"]), termsConfirmed: z.literal(true)
}).strict();
