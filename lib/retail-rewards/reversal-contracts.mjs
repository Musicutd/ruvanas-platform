import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readCheckoutPolicy, checkoutIdempotencySchema, walletQuerySchema } from "./checkout-contracts.mjs";

const OFF = Object.freeze({ enabled: false, valid: false });
export const REVERSAL_REASONS = Object.freeze(["WRONG_COUPON", "PURCHASE_CANCELLED", "DUPLICATE_CHECKOUT"]);
export const REVERSAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export function readReversalPolicy(env = {}) {
  try {
    const parent = readCheckoutPolicy(env), flag = env?.RUVANAS_RETAIL_REWARDS_REVERSALS_ENABLED;
    if (!parent.valid || ![undefined, "false", "true"].includes(flag)) return OFF;
    return Object.freeze({ enabled: parent.enabled && flag === "true", valid: true });
  } catch { return OFF; }
}
export const reversalQuerySchema = walletQuerySchema;
export const reversalInspectSchema = z.object({ redemptionId: rewardIdSchema, locationId: rewardIdSchema }).strict();
export const reversalRequestSchema = reversalInspectSchema.extend({ reason: z.enum(REVERSAL_REASONS),
  idempotencyKey: checkoutIdempotencySchema, correctionConfirmed: z.literal(true) }).strict();
