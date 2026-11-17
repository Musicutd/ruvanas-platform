import { randomBytes } from "node:crypto";
import { runSerializableTransaction } from "../transaction-retry.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { readPilotAdminPolicy, pilotAdminSchemas } from "./pilot-admin-contracts.mjs";
import { requirePilotAdminAccess } from "./pilot-admin-access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { resolveRewardsEntitlements } from "./entitlements.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
import { hashShopperInvitationToken } from "./shopper-auth-service.mjs";
import { rewardsDenied } from "./errors.mjs";
import { collectPilotReadiness, evaluatePilotReadiness } from "./pilot-readiness.mjs";

const DAY = 86_400_000;
const finite = value => value instanceof Date && Number.isFinite(value.getTime());
const validId = value => rewardIdSchema.safeParse(value).success;
const sorted = values => [...values].sort();
const sameIds = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const profileSelect = { id: true, organisationId: true, locationId: true, publicSlug: true, displayName: true,
  description: true, locality: true, countryCode: true, status: true, networkOptIn: true, revokedAt: true, publishedAt: true };
const offerSelect = { id: true, organisationId: true, programId: true, state: true, publishedRevision: true,
  publishedStartsAt: true, publishedEndsAt: true,
  publishedSnapshot: { select: { organisationId: true, offerId: true, revision: true, terms: true } },
  locations: { where: { scope: "PUBLISHED" }, take: 101, select: { organisationId: true, offerId: true, locationId: true, scope: true } },
  discovery: { select: { organisationId: true, offerId: true, publicSlug: true, revision: true, discoverable: true } } };
class PilotAbort extends Error { constructor(code) { super("Pilot setup declined."); this.result = rewardsDenied(code); } }
const abort = code => { throw new PilotAbort(code); };
function failed(error) { return error instanceof PilotAbort ? error.result : rewardsDenied(error?.code === "P2002" ? "CONFLICT" : "UNAVAILABLE"); }

/** Explicit pilot provisioning only. This never edits paid plans, business
 * users, music permissions, streams, email delivery or registration controls. */
export function createRewardPilotAdminService({ db, env = {}, loadContext, clock = () => new Date() } = {}) {
  function nowAt(earliest) {
    if (!readPilotAdminPolicy(env).enabled) abort("FEATURE_DISABLED");
    const now = clock(); if (!finite(now) || earliest && now < earliest) abort("UNAVAILABLE"); return new Date(now);
  }
  async function guard(client, organisationId, previous) {
    const access = await requirePilotAdminAccess({ env, clock, organisationId, previous, loadContext: () => loadContext(client) });
    if (!access?.ok) abort(access?.code || "UNAVAILABLE"); return access;
  }
  async function lockAuthority(tx, access) {
    const users = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${access.userId} FOR SHARE`;
    const sessions = await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${access.sessionId} AND "userId" = ${access.userId} FOR SHARE`;
    if (users.length !== 1 || users[0].id !== access.userId || sessions.length !== 1 || sessions[0].id !== access.sessionId) abort("UNAUTHENTICATED");
    // A preview owner's grant can be revoked independently of the User row.
    // Lock it before the fresh transaction guard; ordinary admins have no row.
    await tx.$queryRaw`SELECT "userId" FROM "PrivatePreviewAccess" WHERE "userId" = ${access.userId} FOR SHARE`;
    // A Super Admin's selected session organisation can differ from the pilot.
    // Protect its existing timeout/SSO policy as well as the target's policy.
    await tx.$queryRaw`SELECT p."id" FROM "EnterpriseSecurityPolicy" p JOIN "Session" s ON s."activeOrganisationId" = p."organisationId"
      WHERE s."id" = ${access.sessionId} FOR SHARE OF p`;
  }
  async function lockOrganisation(tx, id) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${id} FOR UPDATE`;
    if (rows.length !== 1 || rows[0].id !== id) abort("NOT_ENTITLED");
  }
  async function lockPilotAuthority(tx, organisationId) {
    // Ordinary reads keep the SERIALIZABLE snapshot. Lock exact existing rows
    // even when disabled so a concurrent revocation committed while waiting
    // forces 40001/retry, rather than authorising with a stale grant. Programme
    // first matches the ordinary offer service's authority ordering.
    const programs = await tx.$queryRaw`SELECT "id" FROM "RewardProgram" WHERE "organisationId" = ${organisationId} FOR UPDATE`;
    if (programs.length > 1) abort("UNAVAILABLE");
    const subscriptions = await tx.$queryRaw`SELECT sub."id" FROM "Subscription" sub
      JOIN "Plan" p ON p."id" = sub."planId" WHERE sub."organisationId" = ${organisationId} FOR SHARE OF sub, p`;
    if (subscriptions.length !== 1 || !validId(subscriptions[0].id)) abort("NOT_ENTITLED");
    const grants = await tx.$queryRaw`SELECT "id" FROM "RewardEntitlementGrant" WHERE "organisationId" = ${organisationId} FOR SHARE`;
    if (grants.length > 1) abort("UNAVAILABLE");
    await tx.$queryRaw`SELECT "id" FROM "BillingContract" WHERE "subscriptionId" = ${subscriptions[0].id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "EnterpriseSecurityPolicy" WHERE "organisationId" = ${organisationId} FOR SHARE`;
    // Existing optional policy rows are protected; insertion of a previously
    // absent policy follows serializable ordering, not a claimed gap lock.
  }
  async function organisationState(tx, organisationId) {
    const organisation = await tx.organisation.findUnique({ where: { id: organisationId }, select: { id: true, name: true,
      subscription: { include: { plan: true, billingContract: true } } } });
    if (!organisation || organisation.id !== organisationId || !validId(organisation.subscription?.id) || organisation.subscription.organisationId !== organisationId) abort("NOT_ENTITLED");
    const state = await createRewardsDatabaseAdapter(tx).loadRewardsState({ organisationId, subscriptionId: organisation.subscription.id });
    const program = await tx.rewardProgram.findUnique({ where: { organisationId }, select: { id: true, organisationId: true, status: true, timezone: true, networkOptIn: true } });
    return { organisation, subscription: organisation.subscription, ...state, program };
  }
  function entitled(state, organisationId, now) {
    const program = state.program && { id: state.program.id, organisationId: state.program.organisationId, status: state.program.status };
    const result = resolveRewardsEntitlements({ organisationId, subscription: state.subscription, program, grant: state.grant, action: "READ", now });
    if (!result.allowed || state.program.networkOptIn !== true) abort("NOT_ENTITLED");
    return state.grant;
  }
  async function audit(tx, identity, action, targetType, targetId, metadataJson, now) {
    await tx.rewardPilotAuditEvent.create({ data: { organisationId: identity.organisationId, actorUserId: identity.userId,
      action, targetType, targetId, metadataJson, createdAt: now } });
  }
  async function run(operation, input, execute, write = true) {
    try {
      if (!readPilotAdminPolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
      const parsed = pilotAdminSchemas[operation].safeParse(input); if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
      const values = parsed.data, started = nowAt(), preflight = await guard(db, values.organisationId);
      return await runSerializableTransaction(db, async tx => {
        if (write) {
          await lockOrganisation(tx, values.organisationId);
          if (operation !== "revoke") await lockPilotAuthority(tx, values.organisationId);
          await lockAuthority(tx, preflight);
        }
        if (operation === "readiness") await lockAuthority(tx, preflight);
        const identity = await guard(tx, values.organisationId, preflight);
        const result = await execute(tx, values, identity, nowAt(started));
        await guard(tx, values.organisationId, identity); const finished = nowAt(started);
        if (operation === "readiness") return result(finished);
        if (operation === "organisations" && result.organisations.some(row => !readPilotAdminPolicy(env).organisationIds.includes(row.id))) abort("FORBIDDEN");
        return result;
      });
    } catch (error) { return failed(error); }
  }
  function inspectOffer(row, organisationId) {
    const terms = offerTermsSchema.safeParse(row?.publishedSnapshot?.terms), revision = row?.publishedRevision, links = row?.locations;
    if (!row || row.organisationId !== organisationId || row.state !== "PUBLISHED" || !validId(row.id) || !Number.isInteger(revision) || revision < 1 ||
      !terms.success || row.publishedSnapshot.organisationId !== organisationId || row.publishedSnapshot.offerId !== row.id || row.publishedSnapshot.revision !== revision ||
      !finite(row.publishedStartsAt) || !finite(row.publishedEndsAt) || row.publishedStartsAt.toISOString() !== terms.data.startsAt || row.publishedEndsAt.toISOString() !== terms.data.endsAt ||
      !Array.isArray(links) || !links.length || links.length > 100 || links.some(l => l.organisationId !== organisationId || l.offerId !== row.id || l.scope !== "PUBLISHED") ||
      new Set(links.map(l => l.locationId)).size !== links.length || !sameIds(links.map(l => l.locationId), terms.data.locationIds)) abort("OFFER_UNAVAILABLE");
    return terms.data;
  }
  function secret() { if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) abort("UNAVAILABLE"); return env.SESSION_SECRET; }
  function invitationResult(shopperId, token, expiresAt, membershipExpiresAt) {
    return { ok: true, shopperId, invitationToken: token, invitationExpiresAt: expiresAt.toISOString(), membershipExpiresAt: membershipExpiresAt.toISOString() };
  }
  async function pendingShopper(tx, organisationId, shopperId, now, requireCurrentMembership = true) {
    const origin = await tx.rewardPilotShopperEnrollment.findUnique({ where: { shopperId }, select: { shopperId: true, organisationId: true } });
    if (!origin || origin.organisationId !== organisationId || origin.shopperId !== shopperId) abort("INVITATION_UNAVAILABLE");
    // Same order as shopper invitation acceptance; never lock invitation first.
    const shoppers = await tx.$queryRaw`SELECT "id" FROM "RewardShopper" WHERE "id" = ${shopperId} FOR UPDATE`;
    const memberships = await tx.$queryRaw`SELECT "id" FROM "RewardShopperMembership" WHERE "shopperId" = ${shopperId} FOR SHARE`;
    const invitations = await tx.$queryRaw`SELECT "id" FROM "RewardShopperInvitation" WHERE "shopperId" = ${shopperId} FOR UPDATE`;
    if (shoppers.length !== 1 || shoppers[0].id !== shopperId || memberships.length !== 1 || invitations.length !== 1) abort("INVITATION_UNAVAILABLE");
    const shopper = await tx.rewardShopper.findUnique({ where: { id: shopperId }, select: { id: true, status: true, authVersion: true } });
    const credential = await tx.rewardShopperCredential.findUnique({ where: { shopperId }, select: { shopperId: true } });
    const membership = await tx.rewardShopperMembership.findUnique({ where: { shopperId } });
    const invitation = await tx.rewardShopperInvitation.findUnique({ where: { shopperId } });
    if (!shopper || shopper.status !== "DISABLED" || !Number.isInteger(shopper.authVersion) || shopper.authVersion < 1 || credential || !invitation || invitation.acceptedAt !== null || invitation.shopperId !== shopperId ||
      invitation.id !== invitations[0].id || invitation.authVersion !== shopper.authVersion || !membership || membership.shopperId !== shopperId || membership.id !== memberships[0].id ||
      requireCurrentMembership && (membership.status !== "ACTIVE" || membership.source !== "MANUAL_INTERNAL" || membership.revokedAt !== null || !finite(membership.startsAt) || !finite(membership.expiresAt) || membership.startsAt > now || membership.expiresAt <= now)) abort("INVITATION_UNAVAILABLE");
    return { shopper, invitation, membership };
  }
  return Object.freeze({
    organisations(input = {}) {
      return run("organisations", input, async (tx, _v, _a, now) => {
        const ids = readPilotAdminPolicy(env).organisationIds;
        const rows = await tx.organisation.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 11 });
        if (rows.length > 10 || rows.some(row => !ids.includes(row.id))) abort("UNAVAILABLE");
        return { ok: true, organisations: rows.map(row => ({ id: row.id, name: row.name })), checkedAt: now.toISOString() };
      }, false);
    },
    overview(input) {
      return run("overview", input, async (tx, v, _a, now) => {
        const state = await organisationState(tx, v.organisationId), organisationId = v.organisationId;
        const [locations, profiles, offers, shoppers, events] = await Promise.all([
          tx.location.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true, organisationId: true, name: true }, orderBy: { name: "asc" }, take: 101 }),
          tx.rewardPublicShopProfile.findMany({ where: { organisationId }, select: profileSelect, take: 101 }),
          tx.rewardOffer.findMany({ where: { organisationId, state: "PUBLISHED", publishedEndsAt: { gt: now } }, select: offerSelect, orderBy: { id: "asc" }, take: 101 }),
          tx.rewardPilotShopperEnrollment.findMany({ where: { organisationId }, select: { shopperId: true, organisationId: true,
            shopper: { select: { id: true, displayName: true, status: true, membership: { select: { expiresAt: true } },
              invitation: { select: { expiresAt: true, acceptedAt: true, revokedAt: true } } } } }, orderBy: { createdAt: "desc" }, take: 101 }),
          tx.rewardPilotAuditEvent.findMany({ where: { organisationId }, select: { id: true, action: true, targetType: true, targetId: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 })
        ]);
        if ([locations, profiles, offers, shoppers].some(rows => rows.length > 100)) abort("REVIEW_TOO_LARGE");
        if ([...locations, ...profiles, ...offers, ...shoppers].some(row => row.organisationId !== organisationId)) abort("UNAVAILABLE");
        return { ok: true, organisation: { id: state.organisation.id, name: state.organisation.name },
          program: state.program && { id: state.program.id, status: state.program.status, timezone: state.program.timezone, networkOptIn: state.program.networkOptIn },
          grant: state.grant && { id: state.grant.id, tier: state.grant.tier, status: state.grant.status, expiresAt: state.grant.expiresAt.toISOString(), limits: state.grant.limits },
          locations: locations.map(row => { const p = profiles.find(p => p.locationId === row.id); return { id: row.id, name: row.name,
            profile: p ? { id: p.id, publicSlug: p.publicSlug, displayName: p.displayName, description: p.description, locality: p.locality,
              countryCode: p.countryCode, status: p.status, networkOptIn: p.networkOptIn } : null }; }),
          offers: offers.map(row => { const terms = inspectOffer(row, organisationId), d = row.discovery;
            if (d && (d.organisationId !== organisationId || d.offerId !== row.id)) abort("UNAVAILABLE");
            return { id: row.id, title: terms.title, revision: row.publishedRevision, startsAt: row.publishedStartsAt.toISOString(), endsAt: row.publishedEndsAt.toISOString(),
              locationIds: sorted(terms.locationIds), discovery: d ? { publicSlug: d.publicSlug, revision: d.revision, discoverable: d.discoverable } : null }; }),
          shoppers: shoppers.map(row => { const s = row.shopper, i = s?.invitation, m = s?.membership;
            if (!s || s.id !== row.shopperId || !i || !m || !finite(i.expiresAt) || !finite(m.expiresAt)) abort("UNAVAILABLE");
            return { shopperId: row.shopperId, displayName: s.displayName || "Pilot shopper", status: s.status,
              invitationStatus: i.acceptedAt ? "ACCEPTED" : i.revokedAt ? "REVOKED" : i.expiresAt <= now ? "EXPIRED" : "PENDING",
              invitationExpiresAt: i.expiresAt.toISOString(), membershipExpiresAt: m.expiresAt.toISOString() }; }),
          audit: events.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })), checkedAt: now.toISOString() };
      }, false);
    },
    readiness(input) {
      return run("readiness", input, async (tx, v) => {
        const state = await organisationState(tx, v.organisationId);
        const snapshot = await collectPilotReadiness(tx, v.organisationId, abort);
        // Project only after the final admin guard, using that final clock for
        // every expiry. The snapshot is read-only; no readiness record is saved.
        return now => evaluatePilotReadiness({ organisationId: v.organisationId, state, ...snapshot, env, now, abort });
      }, false);
    },
    prepare(input) {
      return run("prepare", input, async (tx, v, identity, now) => {
        const state = await organisationState(tx, v.organisationId), expiresAt = new Date(v.expiresAt);
        if (state.program || state.grant) abort("CONFLICT");
        if (expiresAt <= now || expiresAt - now > 30 * DAY) abort("INVALID_REQUEST");
        const grant = { id: "proposed-pilot-grant", organisationId: v.organisationId, subscriptionId: state.subscription.id,
          capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: v.tier, status: "TRIAL", startsAt: now, expiresAt, revokedAt: null, limits: v.limits };
        const program = { id: "proposed-pilot-program", organisationId: v.organisationId, status: "ACTIVE" };
        if (!resolveRewardsEntitlements({ organisationId: v.organisationId, subscription: state.subscription, grant, program, action: "READ", now }).allowed) abort("NOT_ENTITLED");
        const created = await tx.rewardProgram.create({ data: { organisationId: v.organisationId, status: "ACTIVE", networkOptIn: true, timezone: "Europe/Malta" }, select: { id: true } });
        await tx.rewardEntitlementGrant.create({ data: { organisationId: v.organisationId, subscriptionId: state.subscription.id,
          capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: v.tier, status: "TRIAL", startsAt: now, expiresAt, limitsVersion: 1, ...v.limits } });
        await audit(tx, identity, "PROGRAM_PREPARED", "PROGRAM", created.id, { status: "PREPARED", expiresAt: expiresAt.toISOString(), limitsVersion: 1 }, now);
        if (expiresAt <= nowAt(now)) abort("INVALID_REQUEST");
        return { ok: true, programId: created.id, expiresAt: expiresAt.toISOString() };
      });
    },
    publishShop(input) {
      return run("publishShop", input, async (tx, v, identity, now) => {
        const state = await organisationState(tx, v.organisationId), grant = entitled(state, v.organisationId, now);
        const locations = await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${v.locationId} AND "organisationId" = ${v.organisationId} AND "status"::text = 'ACTIVE' FOR SHARE`;
        if (locations.length !== 1 || locations[0].id !== v.locationId) abort("LOCATION_UNAVAILABLE");
        const existing = await tx.rewardPublicShopProfile.findUnique({ where: { locationId: v.locationId }, select: profileSelect });
        if (existing && existing.organisationId !== v.organisationId) abort("LOCATION_UNAVAILABLE");
        const count = await tx.rewardPublicShopProfile.count({ where: { organisationId: v.organisationId, status: "PUBLISHED", networkOptIn: true, revokedAt: null,
          ...(existing ? { id: { not: existing.id } } : {}) } });
        if (count >= grant.limits.locations) abort("LIMIT_REACHED");
        const data = { publicSlug: v.publicSlug, displayName: v.displayName, description: v.description, locality: v.locality,
          countryCode: v.countryCode, status: "PUBLISHED", networkOptIn: true, publishedAt: now, revokedAt: null };
        const profile = await tx.rewardPublicShopProfile.upsert({ where: { locationId: v.locationId },
          create: { organisationId: v.organisationId, locationId: v.locationId, ...data }, update: data, select: { id: true } });
        await audit(tx, identity, "SHOP_PUBLISHED", "SHOP", profile.id, { status: "PUBLISHED" }, now);
        entitled(await organisationState(tx, v.organisationId), v.organisationId, nowAt(now));
        return { ok: true, profileId: profile.id };
      });
    },
    approveOffer(input) {
      return run("approveOffer", input, async (tx, v, identity, now) => {
        const state = await organisationState(tx, v.organisationId); entitled(state, v.organisationId, now);
        const locked = await tx.$queryRaw`SELECT "id" FROM "RewardOffer" WHERE "id" = ${v.offerId} AND "organisationId" = ${v.organisationId} FOR UPDATE`;
        if (locked.length !== 1 || locked[0].id !== v.offerId) abort("OFFER_UNAVAILABLE");
        const row = await tx.rewardOffer.findFirst({ where: { id: v.offerId, organisationId: v.organisationId }, select: offerSelect });
        const terms = inspectOffer(row, v.organisationId);
        if (row.programId !== state.program.id || row.publishedEndsAt <= now) abort("OFFER_UNAVAILABLE");
        if (row.publishedRevision !== v.revision) abort("CONFLICT");
        const locationIds = JSON.stringify(sorted(terms.locationIds));
        const lockedLocations = await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "organisationId" = ${v.organisationId}
          AND "id" IN (SELECT jsonb_array_elements_text(${locationIds}::jsonb)) ORDER BY "id" FOR SHARE`;
        const lockedProfiles = await tx.$queryRaw`SELECT "locationId" FROM "RewardPublicShopProfile" WHERE "organisationId" = ${v.organisationId}
          AND "locationId" IN (SELECT jsonb_array_elements_text(${locationIds}::jsonb)) ORDER BY "locationId" FOR SHARE`;
        if (!sameIds(lockedLocations.map(l => l.id), terms.locationIds) || !sameIds(lockedProfiles.map(p => p.locationId), terms.locationIds)) abort("LOCATION_UNAVAILABLE");
        const profiles = await tx.rewardPublicShopProfile.findMany({ where: { organisationId: v.organisationId, locationId: { in: terms.locationIds },
          status: "PUBLISHED", networkOptIn: true, revokedAt: null, publishedAt: { lte: now }, location: { status: "ACTIVE" } }, select: { organisationId: true, locationId: true }, take: 101 });
        if (profiles.length !== terms.locationIds.length || profiles.some(p => p.organisationId !== v.organisationId) || !sameIds(profiles.map(p => p.locationId), terms.locationIds)) abort("LOCATION_UNAVAILABLE");
        const data = { revision: v.revision, publicSlug: v.publicSlug, discoverable: true, approvedAt: now, revokedAt: null };
        await tx.rewardOfferDiscovery.upsert({ where: { offerId: v.offerId }, create: { organisationId: v.organisationId, offerId: v.offerId, ...data }, update: data });
        await audit(tx, identity, "OFFER_APPROVED", "OFFER", v.offerId, { status: "APPROVED", revision: v.revision }, now);
        entitled(await organisationState(tx, v.organisationId), v.organisationId, nowAt(now));
        return { ok: true, offerId: v.offerId, revision: v.revision };
      });
    },
    invite(input) {
      return run("invite", input, async (tx, v, identity, now) => {
        const state = await organisationState(tx, v.organisationId), grant = entitled(state, v.organisationId, now), membershipExpiresAt = new Date(v.expiresAt), key = secret();
        if (membershipExpiresAt <= now || membershipExpiresAt > grant.expiresAt || membershipExpiresAt - now > 30 * DAY) abort("INVALID_REQUEST");
        if (await tx.rewardPilotShopperEnrollment.count({ where: { organisationId: v.organisationId } }) >= 100) abort("LIMIT_REACHED");
        const [credential, invitation] = await Promise.all([
          tx.rewardShopperCredential.findUnique({ where: { emailCanonical: v.email }, select: { shopperId: true } }),
          tx.rewardShopperInvitation.findUnique({ where: { emailCanonical: v.email }, select: { shopperId: true } })
        ]);
        if (credential || invitation) abort("CONFLICT");
        const token = randomBytes(32).toString("hex"), expiresAt = new Date(Math.min(now.getTime() + DAY, membershipExpiresAt.getTime()));
        const shopper = await tx.rewardShopper.create({ data: { displayName: v.displayName, status: "DISABLED", authVersion: 1 }, select: { id: true } });
        await tx.rewardShopperMembership.create({ data: { shopperId: shopper.id, status: "ACTIVE", source: "MANUAL_INTERNAL", startsAt: now, expiresAt: membershipExpiresAt, version: 1 } });
        await tx.rewardShopperInvitation.create({ data: { shopperId: shopper.id, emailCanonical: v.email, tokenHash: hashShopperInvitationToken(token, key),
          authVersion: 1, createdAt: now, expiresAt } });
        await tx.rewardPilotShopperEnrollment.create({ data: { shopperId: shopper.id, organisationId: v.organisationId, createdByUserId: identity.userId, createdAt: now } });
        await audit(tx, identity, "SHOPPER_INVITED", "SHOPPER", shopper.id, { status: "INVITED", expiresAt: expiresAt.toISOString() }, now);
        if (secret() !== key) abort("UNAVAILABLE");
        const checked = nowAt(now); if (expiresAt <= checked || membershipExpiresAt <= checked) abort("INVITATION_UNAVAILABLE");
        entitled(await organisationState(tx, v.organisationId), v.organisationId, checked);
        return invitationResult(shopper.id, token, expiresAt, membershipExpiresAt);
      });
    },
    reissue(input) {
      return run("reissue", input, async (tx, v, identity, now) => {
        const state = await organisationState(tx, v.organisationId), grant = entitled(state, v.organisationId, now), key = secret();
        const { shopper, invitation, membership } = await pendingShopper(tx, v.organisationId, v.shopperId, now);
        const token = randomBytes(32).toString("hex"), expiresAt = new Date(Math.min(now.getTime() + DAY, membership.expiresAt.getTime(), grant.expiresAt.getTime()));
        if (expiresAt <= now) abort("INVITATION_UNAVAILABLE");
        await tx.rewardShopperInvitation.update({ where: { id: invitation.id }, data: { tokenHash: hashShopperInvitationToken(token, key),
          authVersion: shopper.authVersion, createdAt: now, expiresAt, revokedAt: null } });
        await audit(tx, identity, "INVITATION_REISSUED", "SHOPPER", shopper.id, { status: "REISSUED", expiresAt: expiresAt.toISOString() }, now);
        if (secret() !== key) abort("UNAVAILABLE");
        const checked = nowAt(now); if (expiresAt <= checked || membership.expiresAt <= checked) abort("INVITATION_UNAVAILABLE");
        entitled(await organisationState(tx, v.organisationId), v.organisationId, checked);
        return invitationResult(shopper.id, token, expiresAt, membership.expiresAt);
      });
    },
    revoke(input) {
      return run("revoke", input, async (tx, v, identity, now) => {
        const { shopper, invitation } = await pendingShopper(tx, v.organisationId, v.shopperId, now, false);
        if (invitation.revokedAt !== null) abort("CONFLICT");
        await tx.rewardShopperInvitation.update({ where: { id: invitation.id }, data: { revokedAt: now } });
        await audit(tx, identity, "INVITATION_REVOKED", "SHOPPER", shopper.id, { status: "REVOKED" }, now);
        return { ok: true, shopperId: shopper.id };
      });
    }
  });
}
