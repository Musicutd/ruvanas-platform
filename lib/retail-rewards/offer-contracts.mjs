import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";

export const REWARD_CATEGORIES = Object.freeze([
  { value: "FASHION", label: "Fashion" }, { value: "RESTAURANTS", label: "Restaurants" },
  { value: "HOME", label: "Home" }, { value: "BEAUTY", label: "Beauty" },
  { value: "HEALTH", label: "Health" }, { value: "LEISURE", label: "Leisure" },
  { value: "GROCERY", label: "Grocery" }, { value: "SERVICES", label: "Services" },
  { value: "OTHER", label: "Other" }
].map(Object.freeze));

const text = (min, max) => z.string().trim().min(min).max(max)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), "Unsupported control character.");
const amount = z.number().int().min(0).max(100_000_000);
const positiveLimit = z.number().int().min(1).max(100_000_000);
const utcDate = z.iso.datetime({ offset: false }).refine(value => Number.isFinite(Date.parse(value)));
const timezone = z.string().min(1).max(64).refine(value => {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(0); return true; }
  catch { return false; }
}, "Choose a valid time zone.");

// Consumer-visible terms are snapshotted on publication. These rules do not
// issue claims, charge shoppers, bypass a grant, or perform checkout redemption.
export const offerTermsSchema = z.object({
  schemaVersion: z.literal(1),
  title: text(1, 140), description: text(0, 2000),
  category: z.enum(REWARD_CATEGORIES.map(row => row.value)),
  type: z.enum(["PERCENT_OFF", "FIXED_AMOUNT", "BOGO"]),
  percentBps: z.number().int().min(1).max(10000).nullable(),
  amountMinor: amount.refine(value => value > 0).nullable(),
  buyQuantity: z.number().int().min(1).max(100).nullable(),
  getQuantity: z.number().int().min(1).max(100).nullable(),
  currency: z.enum(["EUR", "USD", "GBP", "CAD"]),
  minimumSpendMinor: amount, exclusions: text(0, 2000), legalTerms: text(1, 5000),
  combinable: z.boolean(), startsAt: utcDate, endsAt: utcDate, timezone,
  locationIds: z.array(rewardIdSchema).min(1).max(500)
    .refine(values => new Set(values).size === values.length, "Choose each shop only once."),
  usage: z.enum(["SINGLE_USE", "REUSABLE"]),
  totalLimit: positiveLimit,
  perShopperLimit: z.number().int().min(1).max(1_000_000),
  perShopperDailyLimit: z.number().int().min(1).max(1_000_000),
  pausedClaimsPolicy: z.enum(["HONOUR_ISSUED", "BLOCK_WHILE_PAUSED"])
}).strict().superRefine((value, context) => {
  const issue = (field, message) => context.addIssue({ code: "custom", path: [field], message });
  if (value.type === "PERCENT_OFF" && (value.percentBps === null || value.amountMinor !== null || value.buyQuantity !== null || value.getQuantity !== null)) {
    issue("percentBps", "A percentage offer needs only a percentage discount.");
  }
  if (value.type === "FIXED_AMOUNT" && (value.amountMinor === null || value.percentBps !== null || value.buyQuantity !== null || value.getQuantity !== null)) {
    issue("amountMinor", "A fixed discount needs only a money amount.");
  }
  if (value.type === "BOGO" && (value.buyQuantity === null || value.getQuantity === null || value.amountMinor !== null || value.percentBps !== null)) {
    issue("buyQuantity", "A buy/get offer needs quantities, without another discount type.");
  }
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) issue("endsAt", "End must be after the start.");
  if (value.perShopperDailyLimit > value.perShopperLimit) issue("perShopperDailyLimit", "Daily uses cannot exceed total uses per shopper.");
  if (value.perShopperLimit > value.totalLimit) issue("perShopperLimit", "Uses per shopper cannot exceed the offer's total uses.");
  if (value.usage === "SINGLE_USE" && (value.perShopperLimit !== 1 || value.perShopperDailyLimit !== 1)) {
    issue("usage", "Single-use offers allow one use per shopper.");
  }
});

export const createOfferSchema = z.object({ terms: offerTermsSchema }).strict();
export const offerTransitionSchema = z.object({ expectedVersion: z.number().int().min(1).max(2_147_483_646) }).strict();
export const updateOfferSchema = offerTransitionSchema.extend({ terms: offerTermsSchema }).strict();
export const offerListSchema = z.object({
  search: text(0, 140).optional(),
  category: z.enum(REWARD_CATEGORIES.map(row => row.value)).optional(),
  state: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"]).optional(),
  page: z.number().int().min(1).max(1000).optional()
}).strict();

export function validateOfferTerms(input) {
  const result = offerTermsSchema.safeParse(input);
  if (result.success) return { ok: true, terms: result.data };
  return { ok: false, issues: result.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })) };
}

export function offerDisplayState(offer, now = new Date()) {
  if (offer.state === "CANCELLED") return "CANCELLED";
  if (!offer.publishedRevision) return "DRAFT";
  const end = new Date(offer.publishedEndsAt).getTime();
  const start = new Date(offer.publishedStartsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now.getTime())) return "UNAVAILABLE";
  if (end <= now.getTime()) return "EXPIRED";
  if (offer.state === "PAUSED") return "PAUSED";
  return start > now.getTime() ? "SCHEDULED" : "ACTIVE";
}
