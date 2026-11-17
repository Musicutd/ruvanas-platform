import { randomUUID } from "node:crypto";
import { createRewardCheckoutService, hashRewardCheckoutToken } from "../../lib/retail-rewards/checkout-service.mjs";

export const NOW = new Date("2026-11-14T12:00:00Z"), START = new Date("2026-11-01T00:00:00Z"), END = new Date("2026-12-01T00:00:00Z");
export const SECRET = "synthetic-checkout-secret-at-least32", CODE = "ab".repeat(32);
export const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "true", SESSION_SECRET: SECRET };
export const ACCESS = { ok: true, shopperId: "shopper-one", sessionId: "shopper-session", membershipId: "shopper-membership" };
export const clone = value => structuredClone(value);
export function terms(patch = {}) { return { schemaVersion: 1, title: "Issued home offer", description: "Ten percent", category: "HOME", type: "PERCENT_OFF",
  percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000,
  exclusions: "Gift cards", legalTerms: "Synthetic terms; cashier confirms purchase.", combinable: false, startsAt: START.toISOString(), endsAt: END.toISOString(),
  timezone: "Europe/Malta", locationIds: ["shop-one"], usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10, perShopperDailyLimit: 3,
  pausedClaimsPolicy: "HONOUR_ISSUED", ...patch }; }
export function fixture() {
  const f = { now: NOW, env: { ...ENV }, calls: [], beforeTransaction: null, afterWrite: null, afterAuth: null, authCount: 0, failReceipt: false };
  const subscription = { id: "sub-one", organisationId: "org-one", status: "ACTIVE", plan: { code: "RETAIL_START", active: true, retailRadioEnabled: true } };
  const member = { id: "member-one", userId: "user-one", organisationId: "org-one", role: "OWNER" };
  f.context = { user: { id: "user-one", role: "OWNER" }, session: { id: "staff-session", userId: "user-one", activeOrganisationId: "org-one", authMethod: "PASSWORD", expiresAt: END, revokedAt: null },
    membership: { ...member, organisation: { id: "org-one", subscription } }, memberships: [member] };
  f.data = { organisations: [{ id: "org-one", subscription }], programs: [{ id: "program-one", organisationId: "org-one", status: "ACTIVE", networkOptIn: true }],
    grants: [{ id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "ACTIVE",
      startsAt: START, expiresAt: END, revokedAt: null, limitsVersion: 1, activeOffers: 10, locations: 10, staffSeats: 5, monthlyRedemptions: 100, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false }],
    staff: [{ id: "staff-grant", organisationId: "org-one", organisationMemberId: "member-one", scope: "LOCATIONS", locationId: "shop-one", capabilities: ["REDEEM"], startsAt: START, expiresAt: END, revokedAt: null }],
    locations: [{ id: "shop-one", organisationId: "org-one", status: "ACTIVE", name: "Public Home Shop" }, { id: "shop-two", organisationId: "org-one", status: "ACTIVE", name: "Second shop" }],
    shoppers: [{ id: "shopper-one", status: "ACTIVE", authVersion: 1, membership: { id: "shopper-membership", shopperId: "shopper-one", status: "ACTIVE", source: "MANUAL_INTERNAL", startsAt: START, expiresAt: END, revokedAt: null, version: 1 } }],
    offers: [{ id: "offer-one", organisationId: "org-one", programId: "program-one", state: "PUBLISHED", publishedRevision: 2, draft: terms({ title: "Unpublished confidential draft", percentBps: 9000 }) }],
    snapshots: [{ organisationId: "org-one", offerId: "offer-one", revision: 1, terms: terms() }],
    policies: [{ offerId: "offer-one", organisationId: "org-one", timezone: "Europe/Malta" }],
    claims: [{ id: "claim-one", organisationId: "org-one", offerId: "offer-one", revision: 1, shopperId: "shopper-one", shopperAuthVersion: 1, locationId: "shop-one",
      publicShopName: "Public Home Shop", publicShopSlug: "home-shop", createdAt: new Date(NOW - 1000), expiresAt: new Date(NOW.getTime() + 3600_000) }],
    tokens: [{ claimId: "claim-one", tokenHash: hashRewardCheckoutToken(CODE, SECRET), createdAt: new Date(NOW - 1000), expiresAt: new Date(NOW.getTime() + 240_000) }],
    enrollments: [{ shopperId: "shopper-one", organisationId: "org-one" }], receipts: [], requests: [], reversals: [] };
  function expand(source, key, row) {
    if (!row) return null;
    if (key === "claims") return { ...row, publishedSnapshot: source.snapshots.find(s => s.offerId === row.offerId && s.revision === row.revision),
      usagePolicy: source.policies.find(p => p.offerId === row.offerId), redemption: source.receipts.some(r => r.claimId === row.id) ? { ...source.receipts.find(r => r.claimId === row.id), reversal: source.reversals.find(r => r.redemptionId === source.receipts.find(r => r.claimId === row.id).id) || null } : null };
    if (key === "reversals") return row;
    if (["tokens", "receipts", "requests"].includes(key)) return { ...row, ...(key === "receipts" ? { reversal: source.reversals.find(r => r.redemptionId === row.id) || null } : {}), claim: expand(source, "claims", source.claims.find(c => c.id === row.claimId)) };
    return row;
  }
  function matches(row, where = {}) {
    if (!row) return false;
    return Object.entries(where).every(([key, value]) => {
      if (key.includes("_")) return matches(row, value);
      const actual = row[key]; if (value === null || typeof value !== "object") return actual === value;
      if (Array.isArray(value.in)) return value.in.includes(actual);
      if (value instanceof Date) return actual?.getTime() === value.getTime();
      if (value.gt !== undefined && !(actual > value.gt)) return false;
      if (value.gte !== undefined && !(actual >= value.gte)) return false;
      if (value.lt !== undefined && !(actual < value.lt)) return false;
      if (value.lte !== undefined && !(actual <= value.lte)) return false;
      if (["gt", "gte", "lt", "lte"].some(k => Object.hasOwn(value, k))) return true;
      return matches(actual, value);
    });
  }
  function project(row, fields) {
    if (!row) return null; if (!fields) return clone(row);
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === true || value.include ? clone(row[key]) : project(row[key], value.select)]));
  }
  function client(source) {
    function delegate(key) {
      const selectRows = where => source[key].map(row => expand(source, key, row)).filter(row => matches(row, where));
      return {
        async findFirst({ where, select } = {}) { f.calls.push([key, "read", clone(where)]); return project(selectRows(where)[0], select); },
        async findUnique(input) { return this.findFirst(input); },
        async findMany({ where, select, skip = 0, take } = {}) { f.calls.push([key, "list", clone(where)]); return selectRows(where).slice(skip, take === undefined ? undefined : skip + take).map(row => project(row, select)); },
        async count({ where }) { f.calls.push([key, "count", clone(where)]); return selectRows(where).length; },
        async create({ data, include }) {
          if ((key === "receipts" && f.failReceipt) || (key === "reversals" && f.failReversal)) throw new Error("private DB connection");
          const row = { id: randomUUID(), ...clone(data) }; source[key].push(row); f.calls.push([key, "write"]); f.afterWrite?.(key);
          return project(include ? expand(source, key, row) : row);
        },
        async upsert({ where, create, update }) { const row = source[key].find(item => matches(item, where));
          if (row) Object.assign(row, clone(update)); else source[key].push(clone(create)); f.calls.push([key, "write"]); f.afterWrite?.(key); return clone(row || create); }
      };
    }
    return { rewardPilotShopperEnrollment: delegate("enrollments"), organisation: delegate("organisations"), rewardProgram: delegate("programs"), rewardEntitlementGrant: delegate("grants"), rewardStaffGrant: delegate("staff"),
      location: delegate("locations"), rewardShopper: delegate("shoppers"), rewardOffer: delegate("offers"), rewardOfferUsagePolicy: delegate("policies"),
      rewardClaim: delegate("claims"), rewardClaimToken: delegate("tokens"), rewardClaimRequest: delegate("requests"), rewardRedemption: delegate("receipts"), rewardRedemptionReversal: delegate("reversals"),
      async $queryRaw(parts, ...values) {
        const sql = parts.join("?"); f.calls.push(["raw", sql]);
        if (sql.includes('FROM "RewardProgram"')) return source.programs.filter(r => r.organisationId === values[0]).map(({ id }) => ({ id }));
        if (sql.includes('FROM "RewardOffer"')) return source.offers.filter(r => r.organisationId === values[0] && r.id === values[1]).map(({ id }) => ({ id }));
        if (sql.includes('FROM "Subscription"')) return source.organisations.filter(r => r.id === values[0]).map(r => ({ id: r.subscription.id }));
        if (sql.includes('FROM "Session"')) return [{ id: f.context.session.id }];
        if (sql.includes('FROM "RewardStaffGrant"')) return source.staff.map(({ id }) => ({ id }));
        if (sql.includes('FROM "RewardShopper"')) return source.shoppers.filter(r => r.id === values[0]).map(({ id }) => ({ id }));
        if (sql.includes('FROM "RewardShopperMembership"')) return source.shoppers.filter(r => r.id === values[0]).map(r => ({ id: r.membership.id }));
        if (sql.includes('FROM "RewardShopperSession"')) return [{ id: ACCESS.sessionId }];
        if (sql.includes('FROM "Location"')) return source.locations.filter(r => r.id === values[0] && r.organisationId === values[1]).map(({ id }) => ({ id }));
        if (sql.includes('FROM "RewardClaimToken"')) return source.tokens.filter(r => r.claimId === values[0]).map(({ claimId }) => ({ claimId }));
        if (sql.includes('FROM "BillingContract"') || sql.includes('FROM "EnterpriseSecurityPolicy"')) return [];
        if (sql.includes('FROM "RewardRedemption"')) {
          if (sql.includes("FOR UPDATE")) return source.receipts.filter(r => r.id === values[0] && r.organisationId === values[1] && r.locationId === values[2]).map(({ id }) => ({ id }));
          const rows = source.receipts.filter(r => r.offerId === values[5] && r.organisationId === values[6] && !source.reversals.some(c => c.redemptionId === r.id && c.organisationId === r.organisationId));
          return [{ total: BigInt(rows.length), personal: BigInt(rows.filter(r => r.shopperId === values[0]).length), daily: BigInt(rows.filter(r => r.shopperId === values[0] && r.occurredAt.toISOString().slice(0, 10) === f.now.toISOString().slice(0, 10)).length) }];
        }
        throw new Error("Unexpected query");
      } };
  }
  f.db = { ...client(f.data), async $transaction(operation, options) { f.calls.push(["transaction", options]); await f.beforeTransaction?.();
    const snapshot = clone(f.data), result = await operation(client(snapshot)); Object.keys(f.data).forEach(k => { f.data[k] = snapshot[k]; }); return result; } };
  f.service = createRewardCheckoutService({ db: f.db, env: f.env, clock: () => f.now,
    loadShopper: async () => { f.authCount++; return f.afterAuth?.(f.authCount) || clone(ACCESS); }, loadContext: async () => clone(f.context) });
  f.input = { token: CODE, locationId: "shop-one", idempotencyKey: randomUUID(), eligibleSpendMinor: 5001, currency: "EUR", termsConfirmed: true };
  return f;
}

