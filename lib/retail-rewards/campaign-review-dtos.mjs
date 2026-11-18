import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
const instant = z.string().refine(value => { const d = new Date(value); return Number.isFinite(d.getTime()) && d.toISOString() === value; });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
});
const revision = z.number().int().min(1).max(2147483647);
const offer = z.object({ id: rewardIdSchema, title: z.string().min(1).max(140), revision, startsAt: instant, endsAt: instant,
  shopCount: z.number().int().min(1).max(500) }).strict().refine(value => value.startsAt < value.endsAt);
const campaign = z.object({ id: rewardIdSchema, name: z.string().min(1).max(500), publicationRevision: revision,
  publishedAt: instant, startsOn: day, endsOn: day, promoName: z.string().min(1).max(500)
}).strict().refine(value => value.startsOn <= value.endsOn);
const shared = { ok: z.literal(true), page: z.number().int().min(1).max(1000), hasMore: z.boolean(), checkedAt: instant, reviewOnly: z.literal(true) };
const schemas = {
  offers: z.object({ ...shared, offers: z.array(offer).max(25) }).strict()
    .refine(value => new Set(value.offers.map(row => row.id)).size === value.offers.length && value.offers.every(row => row.endsAt > value.checkedAt)),
  review: z.object({ ...shared, offer, campaigns: z.array(campaign).max(25) }).strict()
    .refine(value => value.offer.endsAt > value.checkedAt && new Set(value.campaigns.map(row => row.id)).size === value.campaigns.length &&
      value.campaigns.every(row => row.publishedAt <= value.checkedAt))
};
export function safeCampaignReviewResult(operation, value) {
  const parsed = schemas[operation]?.safeParse(value); return parsed?.success ? parsed.data : null;
}
