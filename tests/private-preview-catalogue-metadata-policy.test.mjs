import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPreviewTesterModePillars, assertPreviewTesterState, isPreviewOnlineDraftAccessMode,
  PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN_CODE,
  PREVIEW_ONLINE_DRAFT_PLAN, PREVIEW_TESTER_PLAN, previewTesterAccessMode,
  previewTesterCatalogueMetadataPolicy, previewTesterOverrides
} from "../lib/private-preview-account-policy.mjs";
import { isPrivatePreviewOnlineDraftSession, privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";
import { onlineDraftSubscription } from "../lib/private-preview-online-draft.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { eligibleOnlineRadioRotation, eligibleScheduledOnlineRotation } from "../lib/online-radio-output.mjs";

const NOW = new Date("2026-10-19T12:00:00Z");
const EXPIRY = new Date("2026-11-18T12:00:00Z");
const ID = `c${"a".repeat(24)}`;
function session(plan = PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN) {
  const grant = { userId: "tester", organisationId: "isolated-org", enabled: true,
    passwordEnabled: true, pillars: ["ONLINE"], expiresAt: EXPIRY };
  const subscription = { organisationId: "isolated-org", plan: { ...plan }, billingContract: null,
    status: "TRIAL", currentPeriodEnd: EXPIRY, complimentaryAccessActive: false,
    schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false,
    ...previewTesterOverrides(["ONLINE"]) };
  return { activeOrganisationId: "isolated-org", authMethod: "PREVIEW_PASSWORD", revokedAt: null,
    user: { id: "tester", role: "OWNER", privatePreviewAccess: grant,
      memberships: [{ organisationId: "isolated-org", role: "OWNER", organisation: { enterpriseSecurityPolicy: null, subscription } }] } };
}
const subscriptionOf = actor => actor.user.memberships[0].organisation.subscription;
const allowed = (actor, pathname = "/api/catalogue/music", method = "GET") =>
  privatePreviewTesterRequestAllowed({ session: actor, pathname, method, now: NOW });

test("Malta metadata mode is a separate exact hidden plan with no additional audio or paid capabilities", () => {
  const plan = PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN;
  assert.equal(plan.code, PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN_CODE);
  assert.equal(plan.code, "PRIVATE_PREVIEW_ONLINE_DRAFT_CATALOGUE_MT_V1");
  assert.equal(previewTesterAccessMode(plan), "ONLINE_DRAFT_CATALOGUE");
  assert.equal(Object.isFrozen(plan), true);
  const { code, name, ...unchanged } = plan;
  const { code: oldCode, name: oldName, ...oldFields } = PREVIEW_ONLINE_DRAFT_PLAN;
  assert.deepEqual(unchanged, oldFields);
  assert.match(name, /Malta.*metadata only.*no audio/i);
  assert.deepEqual(previewTesterCatalogueMetadataPolicy(plan), { territory: "MT", catalogueLevel: "FOCUSED" });
  assert.equal(Object.isFrozen(previewTesterCatalogueMetadataPolicy(plan)), true);
  for (const mode of ["ONLINE_DRAFT", "ONLINE_DRAFT_CATALOGUE"]) {
    assert.equal(isPreviewOnlineDraftAccessMode(mode), true);
    assert.doesNotThrow(() => assertPreviewTesterModePillars(mode, ["ONLINE"]));
    for (const pillars of [["RETAIL"], ["ONLINE", "SCHOOL"]]) {
      assert.throws(() => assertPreviewTesterModePillars(mode, pillars), { code: "INVALID_ACCESS_MODE_PILLARS" });
    }
  }
  for (const mode of [null, "READ_ONLY", "online_draft_catalogue", true, {}, "PRIVATE_PREVIEW_ONLINE_DRAFT_CATALOGUE_MT_V1"]) {
    assert.equal(isPreviewOnlineDraftAccessMode(mode), false);
  }
});

test("metadata policy requires every expected plan field, never the code or a supplied flag alone", () => {
  for (const plan of [null, {}, PREVIEW_TESTER_PLAN, PREVIEW_ONLINE_DRAFT_PLAN,
    { code: PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN_CODE }, { ...PREVIEW_ONLINE_DRAFT_PLAN, sandboxCatalogueMetadata: true }]) {
    assert.equal(previewTesterCatalogueMetadataPolicy(plan), null);
  }
  for (const [field, value] of Object.entries(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN)) {
    const changed = { ...PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, [field]: typeof value === "boolean" ? !value : typeof value === "number" ? value + 1 : `${value}-changed` };
    assert.equal(previewTesterCatalogueMetadataPolicy(changed), null, field);
    assert.equal(onlineDraftSubscription({ plan: changed }), false, field);
    assert.equal(allowed(session(changed)), false, field);
  }
});

test("only structurally valid metadata testers receive exact GET/HEAD catalogue access", () => {
  const actor = session();
  assert.equal(assertPreviewTesterState(actor.user, { now: NOW }).accessMode, "ONLINE_DRAFT_CATALOGUE");
  assert.equal(isPrivatePreviewOnlineDraftSession(actor, NOW), true);
  assert.equal(onlineDraftSubscription(subscriptionOf(actor)), true);
  for (const method of ["GET", "HEAD"]) assert.equal(allowed(actor, "/api/catalogue/music", method), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get"]) assert.equal(allowed(actor, "/api/catalogue/music", method), false);
  for (const pathname of ["/api/catalogue/music/", "/api/catalogue/music/extra", "/api/catalogue/music-export", "/api/catalogue/music?q=pop", "/api/catalogue//music"]) {
    assert.equal(allowed(actor, pathname), false, pathname);
  }
  for (const plan of [PREVIEW_TESTER_PLAN, PREVIEW_ONLINE_DRAFT_PLAN]) {
    const original = session(plan); original.sandboxCatalogueMetadata = true;
    original.user.privatePreviewAccess.catalogueMetadata = true;
    assert.equal(allowed(original), false);
  }
});

test("expired, disabled, wrong-pillar, tenant, role and password sessions never acquire metadata access", () => {
  const changes = [
    actor => { actor.user.privatePreviewAccess.enabled = false; },
    actor => { actor.user.privatePreviewAccess.expiresAt = NOW; },
    actor => { actor.user.privatePreviewAccess.passwordEnabled = false; },
    actor => { actor.user.privatePreviewAccess.pillars = ["ONLINE", "RETAIL"]; },
    actor => { actor.user.privatePreviewAccess.pillars = ["RETAIL"]; },
    actor => { actor.activeOrganisationId = "another-org"; },
    actor => { actor.user.memberships[0].organisationId = "another-org"; },
    actor => { actor.user.memberships.push(structuredClone(actor.user.memberships[0])); },
    actor => { actor.user.role = "SUPER_ADMIN"; },
    actor => { actor.authMethod = "PASSWORD"; },
    actor => { actor.revokedAt = NOW; },
    actor => { subscriptionOf(actor).billingContract = {}; },
    actor => { subscriptionOf(actor).currentPeriodEnd = NOW; },
    actor => { subscriptionOf(actor).complimentaryAccessActive = true; },
    actor => { subscriptionOf(actor).plan.includesRuvanasCatalogue = true; }
  ];
  for (const change of changes) {
    const actor = session(); change(actor);
    assert.equal(allowed(actor), false, change.toString());
    assert.equal(allowed(actor, "/api/programming/simple", "POST"), false, change.toString());
  }
  const code = session(); code.authMethod = "PREVIEW_CODE"; code.user.privatePreviewAccess.passwordEnabled = false;
  assert.equal(allowed(code), true, "a valid owner-issued code retains its original sign-in semantics");
});

test("new mode preserves only existing bounded draft writes and never opens media, publication or billing", () => {
  const actor = session();
  for (const [pathname, method] of [["/api/stations", "POST"], ["/api/programming/simple", "POST"],
    [`/api/programming/simple/${ID}`, "POST"], [`/api/programming/simple/${ID}`, "PATCH"],
    ["/api/programming/advanced-scheduler", "POST"], [`/api/programming/advanced-scheduler/${ID}`, "PUT"]]) {
    assert.equal(allowed(actor, pathname, method), true);
    assert.equal(allowed(session(PREVIEW_ONLINE_DRAFT_PLAN), pathname, method), true);
  }
  for (const pathname of [`/api/media/${ID}/stream`, `/api/media/${ID}`, `/api/stations/${ID}/stream`,
    "/api/player/token", `/api/promo-only/downloads/queue/${ID}`, `/api/programming/advanced-scheduler/${ID}/versions/${ID}/publish`,
    "/api/programming/simple/events", "/api/programming/simple/nonstop", "/api/studio/broadcast",
    "/api/media/upload", "/api/media/music", "/api/auth/register", "/api/billing/checkout",
    "/dashboard/radio/listen", "/dashboard/listen/online"]) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
      if (pathname === "/api/media/music" && ["GET", "HEAD"].includes(method)) continue; // Existing read-only own-library metadata is unchanged.
      assert.equal(allowed(actor, pathname, method), false, `${method} ${pathname}`);
    }
  }
});

test("entitlements mark metadata browsing without granting catalogue playback or weakening output-off", () => {
  const subscription = subscriptionOf(session());
  const entitlements = resolveEntitlements(subscription, NOW);
  assert.equal(entitlements.serviceEnabled, true);
  assert.equal(entitlements.sandboxDraftOnly, true);
  assert.equal(entitlements.sandboxCatalogueMetadata, true);
  assert.equal(entitlements.outputEnabled, false);
  assert.equal(entitlements.includesRuvanasCatalogue, false);
  assert.equal(entitlements.licensedMusicCatalogueLevel, "NONE");
  assert.equal(entitlements.licensedMusicCatalogueEnabled, false);
  assert.equal(entitlements.storageLimitGb, 0);
  assert.equal(entitlements.promoUploadEnabled, false);
  assert.equal(entitlements.studioExternalDestinationLimit, 0);
  const unsafeStation = { get productFamily() { throw new Error("No encoder work is allowed"); } };
  assert.deepEqual(eligibleOnlineRadioRotation(unsafeStation, entitlements, NOW), { ready: false, reason: "OUTPUT_NOT_PERMITTED" });
  assert.deepEqual(eligibleScheduledOnlineRotation(unsafeStation, entitlements, {}, [], NOW), { ready: false, reason: "OUTPUT_NOT_PERMITTED" });
  for (const plan of [PREVIEW_TESTER_PLAN, PREVIEW_ONLINE_DRAFT_PLAN]) {
    assert.equal(resolveEntitlements(subscriptionOf(session(plan)), NOW).sandboxCatalogueMetadata, false);
  }
  const expired = resolveEntitlements({ ...subscription, currentPeriodEnd: new Date("2026-01-01") }, NOW);
  assert.equal(expired.sandboxCatalogueMetadata, false);
  assert.equal(expired.outputEnabled, false);
  for (const patch of [{ status: "ACTIVE" }, { billingContract: {} }, { currentPeriodEnd: null },
    { currentPeriodEnd: EXPIRY.toISOString() }, { currentPeriodEnd: new Date("invalid") }]) {
    assert.equal(resolveEntitlements({ ...subscription, ...patch }, NOW).sandboxCatalogueMetadata, false);
  }
  assert.equal(resolveEntitlements(subscription, new Date("invalid")).sandboxCatalogueMetadata, false);
  const complimentary = resolveEntitlements({ ...subscription,
    complimentaryAccessActive: true, complimentaryPlanName: "Synthetic online", complimentaryPlanCode: "ONLINE_1",
    complimentaryProductFamily: "ONLINE", complimentaryTierNumber: 1, complimentaryStationLimit: 1,
    complimentaryStorageLimitGb: 1, complimentaryListenerLimit: 1, complimentaryMaxBitrateKbps: 128
  }, NOW);
  assert.equal(complimentary.sandboxCatalogueMetadata, false);
  assert.equal(complimentary.outputEnabled, false);
});
