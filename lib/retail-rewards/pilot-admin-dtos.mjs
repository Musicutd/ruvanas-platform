import { z } from "zod";
import { rewardIdSchema as id, rewardLimitsSchema as limits } from "./contracts.mjs";
import { pilotReadinessSchema } from "./pilot-readiness-contracts.mjs";
const instant = z.string().refine(v => { const d = new Date(v); return Number.isFinite(d.getTime()) && d.toISOString() === v; });
const revision = z.number().int().min(1).max(2147483647);
const name = z.string().min(1).max(500);
const slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const organisation = z.object({ id, name }).strict();
const profile = z.object({ id, publicSlug: slug, displayName: z.string().min(1).max(140), description: z.string().max(2000),
  locality: z.string().max(120), countryCode: z.string().regex(/^[A-Z]{2}$/), status: z.enum(["DRAFT", "PUBLISHED"]), networkOptIn: z.boolean() }).strict();
const actions = z.enum(["PROGRAM_PREPARED", "SHOP_PUBLISHED", "OFFER_APPROVED", "SHOPPER_INVITED", "INVITATION_REISSUED", "INVITATION_REVOKED", "PILOT_ACCESS_RENEWED"]);
const invitation = z.object({ ok: z.literal(true), shopperId: id, invitationToken: z.string().regex(/^[a-f0-9]{64}$/),
  invitationExpiresAt: instant, membershipExpiresAt: instant }).strict().refine(v => v.invitationExpiresAt <= v.membershipExpiresAt);
const schemas = {
  renewalReview: z.object({ ok: z.literal(true), organisationId: id, shopperId: id, email: z.email().max(254),
    displayName: z.string().min(1).max(80), programId: id,
    grant: z.object({ id, tier: z.enum(["REWARDS_STARTER", "REWARDS_PRO", "REWARDS_BUSINESS", "REWARDS_ENTERPRISE"]), expiresAt: instant, limits }).strict(),
    membership: z.object({ id, expiresAt: instant, version: revision }).strict(),
    invitation: z.object({ id, status: z.literal("REVOKED") }).strict(),
    expectedState: z.string().regex(/^[a-f0-9]{64}$/), checkedAt: instant }).strict(),
  renew: z.object({ ok: z.literal(true), shopperId: id, programId: id, grantId: id, membershipId: id,
    expiresAt: instant, membershipVersion: revision, requestId: z.uuid() }).strict(),
  readiness: pilotReadinessSchema,
  organisations: z.object({ ok: z.literal(true), organisations: z.array(organisation).max(10), checkedAt: instant }).strict(),
  overview: z.object({ ok: z.literal(true), organisation,
    program: z.object({ id, status: z.enum(["DISABLED", "ACTIVE", "PAUSED"]), timezone: z.string().min(1).max(100), networkOptIn: z.boolean() }).strict().nullable(),
    grant: z.object({ id, tier: z.enum(["REWARDS_STARTER", "REWARDS_PRO", "REWARDS_BUSINESS", "REWARDS_ENTERPRISE"]),
      status: z.enum(["DISABLED", "TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"]), expiresAt: instant, limits }).strict().nullable(),
    locations: z.array(z.object({ id, name, status: z.enum(["DRAFT", "ACTIVE"]), profile: profile.nullable() }).strict()).max(100),
    preparedShoppers: z.array(z.object({ shopperId: id, email: z.email().max(254), displayName: z.string().min(1).max(80),
      authVersion: z.literal(1), preparedAt: instant }).strict()).max(100),
    offers: z.array(z.object({ id, title: z.string().min(1).max(140), revision, startsAt: instant, endsAt: instant, locationIds: z.array(id).min(1).max(100),
      discovery: z.object({ publicSlug: slug, revision, discoverable: z.boolean() }).strict().nullable() }).strict()).max(100),
    shoppers: z.array(z.object({ shopperId: id, displayName: z.string().max(140), status: z.enum(["DISABLED", "ACTIVE", "SUSPENDED"]),
      invitationStatus: z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]), invitationExpiresAt: instant, membershipExpiresAt: instant }).strict()).max(100),
    audit: z.array(z.object({ id, action: actions, targetType: z.enum(["PROGRAM", "SHOP", "OFFER", "SHOPPER"]), targetId: id, createdAt: instant }).strict()).max(50),
    checkedAt: instant }).strict(),
  prepare: z.object({ ok: z.literal(true), programId: id, expiresAt: instant }).strict(),
  activateLocation: z.object({ ok: z.literal(true), locationId: id, status: z.literal("ACTIVE") }).strict(),
  publishShop: z.object({ ok: z.literal(true), profileId: id }).strict(),
  approveOffer: z.object({ ok: z.literal(true), offerId: id, revision }).strict(),
  invite: invitation, invitePrepared: invitation, reissue: invitation,
  revoke: z.object({ ok: z.literal(true), shopperId: id }).strict()
};
export function safePilotAdminResult(operation, value) {
  const parsed = Object.hasOwn(schemas, operation) && schemas[operation].safeParse(value);
  return parsed?.success ? parsed.data : null;
}
