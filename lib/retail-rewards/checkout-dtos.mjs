import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { publicSlugSchema } from "./shopper-contracts.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
import { checkoutTokenSchema } from "./checkout-contracts.mjs";

const date = z.iso.datetime({ offset: false }).refine(value => Number.isFinite(Date.parse(value)));
const name = z.string().min(1).max(140);
const revision = z.number().int().positive();
const terms = z.object(Object.fromEntries(Object.entries(offerTermsSchema.shape).filter(([key]) => key !== "locationIds"))).strict()
  .refine(value => offerTermsSchema.safeParse({ ...value, locationIds: ["public-projection-validation"] }).success);
export const checkoutReceiptSchema = z.object({ id: rewardIdSchema, redeemedAt: date, shopName: name, offerTitle: name, revision,
  currency: z.enum(["EUR", "USD", "GBP", "CAD"]), eligibleSpendMinor: z.number().int().min(0).max(100_000_000),
  discountMinor: z.number().int().min(0).max(100_000_000).nullable(),
  reversal: z.object({ id: rewardIdSchema, reversedAt: date, reason: z.enum(["WRONG_COUPON", "PURCHASE_CANCELLED", "DUPLICATE_CHECKOUT"]) }).strict().nullable() }).strict()
  .refine(value => (value.discountMinor === null || value.discountMinor <= value.eligibleSpendMinor) &&
    (value.reversal === null || Date.parse(value.reversal.reversedAt) >= Date.parse(value.redeemedAt)));
const receipt = checkoutReceiptSchema;
const claim = z.object({ id: rewardIdSchema, status: z.enum(["READY", "EXPIRED", "REDEEMED", "REVERSED", "UNAVAILABLE"]),
  shop: z.object({ slug: publicSlugSchema, name }).strict(), revision, terms, createdAt: date, expiresAt: date,
  receipt: receipt.nullable() }).strict().refine(value => {
    if (value.status === "REVERSED") return !!value.receipt?.reversal;
    if (value.status === "REDEEMED") return !!value.receipt && value.receipt.reversal === null;
    return value.receipt === null;
  });
const page = z.number().int().min(1).max(1000);
const OK = { ok: z.literal(true) };
const schemas = {
  claim: z.object({ ...OK, claim }).strict(),
  wallet: z.object({ ...OK, claims: z.array(claim).max(25), page, hasMore: z.boolean() }).strict(),
  credential: z.object({ ...OK, claim: claim.refine(value => value.status === "READY" && value.receipt === null), token: checkoutTokenSchema, tokenExpiresAt: date }).strict(),
  staffLocations: z.object({ ...OK, locations: z.array(z.object({ id: rewardIdSchema, name: z.string().min(1).max(191) }).strict()).max(25), page, hasMore: z.boolean() }).strict(),
  validate: z.object({ ...OK, review: z.object({ shopName: name, offerTitle: name, revision, terms,
    claimExpiresAt: date, tokenExpiresAt: date }).strict() }).strict(),
  redeem: z.object({ ...OK, receipt }).strict()
};
export function safeCheckoutResult(operation, value) {
  const parsed = schemas[operation]?.safeParse(value);
  return parsed?.success ? parsed.data : null;
}
