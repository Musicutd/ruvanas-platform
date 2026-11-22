import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { publicSlugSchema } from "./shopper-contracts.mjs";
import { offerTermsSchema, REWARD_CATEGORIES } from "./offer-contracts.mjs";

export const savedVoucherPairSchema = z.object({ shopSlug: publicSlugSchema, offerSlug: publicSlugSchema }).strict();
export const savedWalletQuerySchema = z.object({ page: z.number().int().min(1).max(1000).optional() }).strict();
export const savedWalletStatusSchema = z.object({ offers: z.array(savedVoucherPairSchema).max(25) }).strict()
  .refine(value => new Set(value.offers.map(pair => `${pair.shopSlug}/${pair.offerSlug}`)).size === value.offers.length);
const date = z.iso.datetime({ offset: false }).refine(value => Number.isFinite(Date.parse(value)));
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const terms = z.object(Object.fromEntries(Object.entries(offerTermsSchema.shape).filter(([key]) => key !== "locationIds"))).strict()
  .refine(value => offerTermsSchema.safeParse({ ...value, locationIds: ["public-projection-validation"] }).success);
const shop = z.object({ slug: publicSlugSchema, name: z.string().min(1).max(140), description: z.string().max(2000),
  locality: z.string().max(120), countryCode: z.string().regex(/^[A-Z]{2}$/), categories: z.array(z.enum(REWARD_CATEGORIES.map(item => item.value))).max(REWARD_CATEGORIES.length) }).strict();
const offer = z.object({ slug: publicSlugSchema, revision: z.number().int().positive(), terms,
  usage: z.object({ limit: count.positive(), used: count, remaining: count, asOf: date }).strict()
    .refine(value => value.remaining === Math.max(0, value.limit - value.used)) }).strict()
  .refine(value => value.usage.limit === value.terms.perShopperLimit);
export const savedWalletItemSchema = z.discriminatedUnion("status", [
  z.object({ id: rewardIdSchema, savedAt: date, status: z.literal("AVAILABLE"), shop, offer }).strict(),
  z.object({ id: rewardIdSchema, savedAt: date, status: z.literal("UNAVAILABLE") }).strict()
]);
const schemas = {
  list: z.object({ ok: z.literal(true), items: z.array(savedWalletItemSchema).max(25), page: z.number().int().min(1).max(1000), hasMore: z.boolean(), savedCount: count }).strict(),
  save: z.object({ ok: z.literal(true), item: savedWalletItemSchema }).strict(),
  remove: z.object({ ok: z.literal(true), removed: z.literal(true) }).strict(),
  status: z.object({ ok: z.literal(true), items: z.array(z.object({ shopSlug: publicSlugSchema, offerSlug: publicSlugSchema, savedId: rewardIdSchema.nullable() }).strict()).max(25) }).strict()
};
export function safeSavedWalletResult(operation, value) {
  const parsed = schemas[operation]?.safeParse(value);
  return parsed?.success ? parsed.data : null;
}
