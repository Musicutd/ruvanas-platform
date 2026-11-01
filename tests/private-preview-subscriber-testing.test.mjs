import assert from "node:assert/strict";
import test from "node:test";
import { isPrivatePreviewSubscriberTestingSession, privatePreviewSubscriberTestingRequestAllowed,
  subscriberWorkflowRequestAllowed } from "../lib/private-preview-subscriber-testing.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";
import { assertPreviewTesterState } from "../lib/private-preview-account-policy.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { isRetailSubscriberSession, RETAIL_SUBSCRIBER_ORGANISATION_ID } from "../lib/retail-subscriber-access.mjs";
import { isTestRadioSubscriberSession } from "../lib/test-radio-subscriber-access.mjs";
import { subscriberTestingContext as fixture, SUBSCRIBER_TESTING_NOW as NOW, testCuid } from "./fixtures/private-preview-subscriber-testing.mjs";

const ID = testCuid(1), OTHER_ID = testCuid(2);
const options = (pathname, method = "POST") => ({ pathname, method, now: NOW });
const allowed = (pathname, method = "POST", context = fixture()) =>
  privatePreviewSubscriberTestingRequestAllowed({ session: context.session, ...options(pathname, method) });
const PHYSICAL = ["RETAIL", "SCHOOL", "HEALTH", "FAITH", "ORGANISATIONS"];
const physicalRoutes = [
  ["POST", "/api/locations"], ["PATCH", `/api/locations/${ID}`],
  ["POST", `/api/locations/${ID}/zones`], ["PATCH", `/api/locations/${ID}/zones/${OTHER_ID}`],
  ["POST", "/api/player-setup"], ["POST", `/api/player-setup/${ID}/replace`]
];

test("subscriber testing requires an explicit boolean database grant and the original complete tester state", () => {
  for (const enabled of [false, undefined, null, "true", 1, {}, []]) {
    const context = fixture(); context.user.privatePreviewAccess.subscriberTestingEnabled = enabled;
    assert.equal(isPrivatePreviewSubscriberTestingSession(context.session, NOW), false);
    assert.equal(allowed("/api/locations", "POST", context), false);
  }
  const context = fixture();
  assert.equal(isPrivatePreviewSubscriberTestingSession(context.session, NOW), true);
  assert.equal(assertPreviewTesterState(context.user, { now: NOW }).accessMode, "READ_ONLY");
  for (const mode of ["ONLINE_DRAFT", "ONLINE_DRAFT_CATALOGUE"]) {
    assert.equal(isPrivatePreviewSubscriberTestingSession(fixture({ mode }).session, NOW), true);
  }
  const codeOnly = fixture(); codeOnly.session.authMethod = "PREVIEW_CODE"; codeOnly.user.privatePreviewAccess.passwordEnabled = false;
  assert.equal(isPrivatePreviewSubscriberTestingSession(codeOnly.session, NOW), true);
});

test("disabled, expired, foreign, malformed or enlarged tester authority fails closed", () => {
  const mutations = [
    c => { c.session.id = null; }, c => { c.session.userId = "foreign-user"; },
    c => { c.session.activeOrganisationId = "foreign-org"; }, c => { c.session.authMethod = "PASSWORD"; },
    c => { c.session.authMethod = "SSO"; }, c => { c.session.authMethod = "PREVIEW_LOGIN_CODE"; },
    c => { c.session.revokedAt = NOW; }, c => { c.session.expiresAt = NOW; },
    c => { c.session.expiresAt = "2026-12-01T00:00:00Z"; }, c => { c.session.expiresAt = new Date("invalid"); },
    c => { c.user.role = "SUPER_ADMIN"; }, c => { c.user.privatePreviewAccess.enabled = false; },
    c => { c.user.privatePreviewAccess.passwordEnabled = false; }, c => { c.user.privatePreviewAccess.expiresAt = NOW; },
    c => { c.user.privatePreviewAccess.organisationId = "foreign-org"; }, c => { c.user.privatePreviewAccess.userId = "foreign-user"; },
    c => { c.user.memberships.push(structuredClone(c.membership)); }, c => { c.membership.role = "VIEWER"; },
    c => { c.membership.organisationId = "foreign-org"; }, c => { c.membership.organisation.subscription.organisationId = "foreign-org"; },
    c => { c.membership.organisation.subscription = null; }, c => { c.membership.organisation.subscription.plan.stationLimit = 100; },
    c => { c.membership.organisation.subscription.status = "ACTIVE"; },
    c => { c.membership.organisation.subscription.billingContract = { status: "ACTIVE" }; },
    c => { c.membership.organisation.subscription.complimentaryAccessActive = true; },
    c => { c.membership.organisation.subscription.digitalSignageEnabled = true; },
    c => { c.user.privatePreviewAccess.pillars = ["RETAIL", "RETAIL"]; },
    c => { c.membership.organisation.enterpriseSecurityPolicy = { ssoRequired: true, passwordFallback: false }; }
  ];
  for (const mutate of mutations) {
    const context = fixture(); mutate(context);
    assert.equal(isPrivatePreviewSubscriberTestingSession(context.session, NOW), false, mutate.toString());
    assert.equal(allowed("/api/locations", "POST", context), false, mutate.toString());
  }
  assert.equal(isPrivatePreviewSubscriberTestingSession(fixture().session, new Date("invalid")), false);
  assert.equal(privatePreviewSubscriberTestingRequestAllowed(), false);
});

test("configuration operations are exact and remain limited to physical-product grants", () => {
  for (const pillar of PHYSICAL) {
    for (const [method, path] of physicalRoutes) assert.equal(allowed(path, method, fixture({ pillars: [pillar] })), true, `${pillar} ${path}`);
  }
  for (const pillar of ["ONLINE", "CORRECTIONS"]) {
    for (const [method, path] of physicalRoutes) assert.equal(allowed(path, method, fixture({ pillars: [pillar] })), false, `${pillar} ${path}`);
  }
  for (const pillar of [...PHYSICAL, "ONLINE"]) {
    const context = fixture({ pillars: [pillar] });
    assert.equal(allowed(`/api/player-sessions/${ID}/revoke`, "POST", context), true);
    assert.equal(allowed(`/api/programming/advanced-scheduler/${ID}/preview`, "GET", context), true);
    assert.equal(allowed(`/api/programming/advanced-scheduler/${ID}/preview`, "HEAD", context), true);
  }
  assert.equal(allowed(`/api/player-sessions/${ID}/revoke`, "POST", fixture({ pillars: ["CORRECTIONS"] })), false);
});

test("own account inspection, in-app notification state and session revocation do not open external delivery or credential writes", () => {
  for (const pillars of [["RETAIL"], ["ONLINE"], ["CORRECTIONS"]]) {
    const context = fixture({ pillars });
    for (const [method, path] of [["GET", "/dashboard/account"], ["HEAD", "/dashboard/account"],
      ["PATCH", "/api/notifications"], ["PATCH", `/api/notifications/${ID}`], ["DELETE", "/api/me/security"]]) {
      assert.equal(allowed(path, method, context), true, `${method} ${path}`);
    }
    assert.equal(allowed("/api/me/security", "PATCH", context), false);
    assert.equal(allowed("/api/notifications/preferences", "PATCH", context), false);
    assert.equal(allowed("/api/support/requests", "POST", context), false);
  }
});

test("output, paid work, arbitrary CRUD, new registration, shared music and administrator powers stay excluded", () => {
  const paths = ["/admin", "/api/admin/players", "/api/admin/organisations", "/api/admin/private-preview/testers",
    "/api/billing/webhooks/generic", "/api/complimentary-access/redeem", "/api/auth/register", "/register",
    "/api/organisation/team", "/api/organisation/team/accept", "/api/me/organisation", "/api/stations",
    "/api/media/upload", "/api/media/music", `/api/media/${ID}/stream`, "/api/catalogue/music",
    "/api/studio/orders", "/api/studio/credits", `/api/studio/orders/${ID}/funding`,
    "/api/studio/broadcast", "/api/studio/playout", "/api/programming/simple", "/api/programming/simple/nonstop",
    "/api/programming/simple/events", `/api/programming/simple/${ID}`, "/api/programming/advanced-scheduler",
    `/api/programming/advanced-scheduler/${ID}`, `/api/programming/advanced-scheduler/${ID}/publish`,
    `/api/stations/${ID}/public-player`, `/api/stations/${ID}/website`, "/api/signage/enrol",
    "/dashboard/signage", "/player", "/api/player/enrol", "/api/player/state", "/api/player/manifest",
    `/api/locations/${ID}/activate`, `/api/locations/${ID}/zones/${OTHER_ID}/channel`,
    "/api/programming/test-retail/commercials/approve"];
  const context = fixture({ pillars: [...PHYSICAL, "ONLINE", "CORRECTIONS"] });
  for (const path of paths) for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(allowed(path, method, context), false, `${method} ${path}`);
  }
  for (const path of ["/api/locations", `/api/locations/${ID}`, `/api/locations/${ID}/zones/${OTHER_ID}`, "/api/player-setup"]) {
    assert.equal(allowed(path, "DELETE"), false, `no unsupported DELETE ${path}`);
  }
});

test("method and pathname lookalikes cannot expand the allowlist", () => {
  const paths = ["/api/locations/", "//api/locations", "/api//locations", "/API/locations", "/api/locations?subscriberTestingEnabled=true",
    "/api/locations#x", "/api/locations/../player-setup", "/api/locations/%2e%2e/player-setup", "/api/locations%2f",
    "/api/locations\\x", "/api/locations/new/zones", "/api/locations/unknown/zones", `/api/locations/${ID.toUpperCase()}/zones`,
    `/api/locations/${ID}/zones/../../billing`, `/api/player-setup/${ID}/replace/anything`,
    "/api/notifications/preferences", "/api/notifications/mark-all", "/api/notifications/cshort", "/api/notifications/" + "c".repeat(2000)];
  for (const path of paths) for (const method of ["POST", "PATCH", "DELETE"]) assert.equal(allowed(path, method), false, `${method} ${path}`);
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS", "post", "TRACE", "CONNECT", undefined]) {
    assert.equal(privatePreviewSubscriberTestingRequestAllowed({ session: fixture().session, pathname: "/api/locations", method, now: NOW }), false, String(method));
  }
});

test("API and UI guard shares middleware decision while rechecking current organisation and membership", () => {
  const context = fixture();
  assert.equal(subscriberWorkflowRequestAllowed(context, options("/api/locations")), true);
  const smallerContext = { ...context, membership: { ...context.membership, organisation: { id: context.membership.organisationId } } };
  assert.equal(subscriberWorkflowRequestAllowed(smallerContext, options("/api/locations")), true);
  for (const mutate of [
    c => { c.user.privatePreviewAccess.subscriberTestingEnabled = false; },
    c => { c.membership = { ...c.membership, organisationId: "foreign" }; },
    c => { c.membership = { ...c.membership, role: "VIEWER" }; },
    c => { c.memberships = []; }, c => { c.memberships = [c.membership, c.membership]; },
    c => { c.user = { ...c.user, id: "foreign" }; },
    c => { c.membership = { ...c.membership, organisation: { ...c.membership.organisation, subscription: null } }; },
    c => { c.user = { ...c.user, privatePreviewAccess: undefined }; }
  ]) {
    const changed = fixture(); mutate(changed);
    assert.equal(subscriberWorkflowRequestAllowed(changed, options("/api/locations")), false, mutate.toString());
  }
  assert.equal(subscriberWorkflowRequestAllowed(null, options("/api/locations")), false);
  for (const [method, pathname] of physicalRoutes) {
    const input = { session: context.session, pathname, method, now: NOW };
    assert.equal(privatePreviewTesterRequestAllowed(input), subscriberWorkflowRequestAllowed(context, input));
    assert.equal(privatePreviewTesterRequestAllowed({ ...input, session: fixture({ enabled: false }).session }), false);
  }
});

test("ordinary subscriber and existing owner flows retain downstream role and plan checks", () => {
  const ordinary = fixture(); ordinary.session.authMethod = "PASSWORD"; delete ordinary.user.privatePreviewAccess;
  ordinary.membership.role = "MANAGER";
  assert.equal(subscriberWorkflowRequestAllowed(ordinary, options("/api/locations")), true);
  for (const activeOrganisationId of [null, "an-old-organisation-id"]) {
    ordinary.session.activeOrganisationId = activeOrganisationId;
    assert.equal(subscriberWorkflowRequestAllowed(ordinary, options("/api/locations")), true);
  }
  // This helper does not elevate a VIEWER; the existing canManage/handler role
  // check remains independently required for ordinary non-preview accounts.
  ordinary.membership.role = "VIEWER";
  assert.equal(subscriberWorkflowRequestAllowed(ordinary, options("/api/locations")), true);
  const owner = fixture(); owner.user.role = "SUPER_ADMIN"; owner.user.privatePreviewAccess.organisationId = null;
  assert.equal(subscriberWorkflowRequestAllowed(owner, options("/api/locations")), true);
});

test("free test-tier selection is GET/POST only for the exact opted-in Retail subscriber", () => {
  const retail = () => fixture({ organisationId: RETAIL_SUBSCRIBER_ORGANISATION_ID, email: "retail@manuelchircop.com" });
  for (const method of ["GET", "POST"]) {
    const context = retail(), input = options("/api/account/test-tier", method);
    assert.equal(allowed(input.pathname, method, context), true);
    assert.equal(privatePreviewTesterRequestAllowed({ session: context.session, ...input }), true);
    assert.equal(subscriberWorkflowRequestAllowed(context, input), true);
    for (const mutate of [
      c => { c.user.privatePreviewAccess.subscriberTestingEnabled = false; },
      c => { c.user.privatePreviewAccess.enabled = false; },
      c => { c.user.privatePreviewAccess.expiresAt = NOW; },
      c => { c.session.expiresAt = NOW; }, c => { c.session.revokedAt = NOW; },
      c => { c.user.email = "another-retail@example.test"; },
      c => { c.session.activeOrganisationId = "another-retail-org"; }
    ]) {
      const changed = retail(); mutate(changed);
      assert.equal(privatePreviewTesterRequestAllowed({ session: changed.session, ...input }), false, mutate.toString());
      assert.equal(subscriberWorkflowRequestAllowed(changed, input), false, mutate.toString());
    }
    for (const context of [fixture(), fixture({ organisationId: RETAIL_SUBSCRIBER_ORGANISATION_ID }),
      fixture({ email: "retail@manuelchircop.com" }), fixture({ mode: "ONLINE_DRAFT_CATALOGUE", email: "radio@manuelchircop.com" })]) {
      assert.equal(privatePreviewTesterRequestAllowed({ session: context.session, ...input }), false);
    }
  }
  for (const method of ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS", "post"]) {
    assert.equal(privatePreviewTesterRequestAllowed({ session: retail().session, ...options("/api/account/test-tier", method) }), false);
  }
  for (const path of ["/api/account/test-tier/", "/api/account/test-tier/RETAIL_ENTERPRISE", "/api/account/test-tier?enabled=true",
    "/api/account/test-tiers", "/api/account/test-tier%2f", "/api/account/test-tier/../billing", "/api/account/plan", "/api/billing/test-tier"]) {
    assert.equal(privatePreviewTesterRequestAllowed({ session: retail().session, ...options(path) }), false, path);
  }
});

test("the additive grant changes neither worker identity/mode nor current subscription limits or output authority", () => {
  const retail = fixture({ enabled: false, organisationId: RETAIL_SUBSCRIBER_ORGANISATION_ID, email: "retail@manuelchircop.com" });
  const radio = fixture({ enabled: false, mode: "ONLINE_DRAFT_CATALOGUE", email: "radio@manuelchircop.com" });
  for (const [context, predicate, mode] of [[retail, isRetailSubscriberSession, "READ_ONLY"], [radio, isTestRadioSubscriberSession, "ONLINE_DRAFT_CATALOGUE"]]) {
    const stored = structuredClone(context.membership.organisation.subscription);
    const before = resolveEntitlements(stored, NOW);
    assert.equal(predicate(context.session, NOW), true);
    context.user.privatePreviewAccess.subscriberTestingEnabled = true;
    const snapshot = structuredClone(context);
    assert.equal(isPrivatePreviewSubscriberTestingSession(context.session, NOW), true);
    assert.equal(predicate(context.session, NOW), true);
    assert.equal(assertPreviewTesterState(context.user, { now: NOW }).accessMode, mode);
    assert.deepEqual(context.membership.organisation.subscription, stored);
    assert.deepEqual(resolveEntitlements(context.membership.organisation.subscription, NOW), before);
    assert.equal(before.outputEnabled, false);
    assert.equal(before.digitalSignageEnabled, false);
    assert.equal(before.maxBitrateKbps, 128);
    assert.equal(before.stationLimit, 1);
    assert.deepEqual(context, snapshot);
  }
  // Existing separately reviewed pilot actions remain available even without
  // this new opt-in. The additional flag is not their playback authority.
  retail.user.privatePreviewAccess.subscriberTestingEnabled = false;
  assert.equal(privatePreviewTesterRequestAllowed({ session: retail.session, ...options("/api/programming/test-retail/commercials/approve") }), true);
});
