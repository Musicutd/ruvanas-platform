import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
const instant = z.string().refine(value => { const d = new Date(value); return Number.isFinite(d.getTime()) && d.toISOString() === value; });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
});
const revision = z.number().int().min(1).max(2147483647), state = z.enum(["DRAFT", "PUBLISHED", "PAUSED", "CANCELLED"]);
const selected = { campaignId: rewardIdSchema, name: z.string().min(1).max(500), publicationRevision: revision };
const campaign = z.object({ id: rewardIdSchema, name: z.string().min(1).max(500), publicationRevision: revision,
  publishedAt: instant, startsOn: day, endsOn: day, promoName: z.string().min(1).max(500) }).strict()
  .refine(value => value.startsOn <= value.endsOn);
export const campaignLinkSnapshotSchema = z.object({ schemaVersion: z.literal(1),
  campaignName: z.string().min(1).max(500), promoName: z.string().min(1).max(500),
  publishedAt: instant, startsOn: day, endsOn: day, locationIds: z.array(rewardIdSchema).min(1).max(100)
}).strict().refine(value => value.startsOn <= value.endsOn && new Set(value.locationIds).size === value.locationIds.length);
const offer = z.object({ id: rewardIdSchema, version: revision, state, displayState: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"]),
  draft: offerTermsSchema, publishedTerms: offerTermsSchema.nullable(), publishedRevision: revision.nullable(), lastRevision: z.number().int().min(0).max(2147483647),
  createdAt: instant, updatedAt: instant }).strict();
const schemas = {
  review: z.object({ ok: z.literal(true), offer: z.object({ id: rewardIdSchema, title: z.string().min(1).max(140), version: revision, state,
    publishedRevision: revision.nullable() }).strict(), selection: z.object(selected).strict().nullable(),
    publishedLink: z.object({ ...selected, revision }).strict().nullable(), campaigns: z.array(campaign).max(25),
    page: z.number().int().min(1).max(1000), hasMore: z.boolean(), checkedAt: instant }).strict()
    .refine(value => new Set(value.campaigns.map(row => row.id)).size === value.campaigns.length &&
      value.campaigns.every(row => row.publishedAt <= value.checkedAt) &&
      (value.publishedLink === null || value.publishedLink.revision === value.offer.publishedRevision)),
  save: z.object({ ok: z.literal(true), offer }).strict()
};
export function safeCampaignLinkResult(operation, value) {
  const parsed = schemas[operation]?.safeParse(value); return parsed?.success ? parsed.data : null;
}
