import { z } from "zod";
import { readShopperFeaturePolicy } from "./shopper-contracts.mjs";

export function readShopperAuthPolicy(env = {}) {
  try {
    const parent = readShopperFeaturePolicy(env), flag = env.RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED;
    const valid = parent.valid && (flag === undefined || flag === "false" || flag === "true");
    return Object.freeze({ enabled: valid && parent.enabled && flag === "true", valid });
  } catch { return Object.freeze({ enabled: false, valid: false }); }
}
export const canonicalEmailSchema = z.string().max(254).trim().toLowerCase().email().regex(/^[\x21-\x7e]+$/);
export const shopperPasswordSchema = z.string().refine(value => [...value].length >= 15 &&
  new TextEncoder().encode(value).byteLength <= 72 && !value.includes("\0") && value.isWellFormed(), "Use at least15 characters and no more than72 UTF-8 bytes.");
export const acceptShopperInvitationSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: shopperPasswordSchema,
  displayName: z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).optional() }).strict();
export const shopperLoginSchema = z.object({ email: canonicalEmailSchema, password: shopperPasswordSchema }).strict();
