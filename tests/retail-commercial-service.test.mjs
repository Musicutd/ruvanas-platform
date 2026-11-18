import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { retailCommercialDraft, saveRetailCommercialDraft, retailCommercialOwnerReview, retailCommercialPublicError } from "../lib/retail-commercial-service.mjs";

const NOW = new Date("2026-10-28T10:00:00Z"), BEFORE = new Date("2026-10-25T08:00:00Z"), EXPIRES = new Date("2026-11-23T13:00:00Z");
const USER = "retail-user", REQUEST = "31400821-cc19-4c1d-bd7a-c723b8d35415", OTHER_REQUEST = "31400821-cc19-4c1d-bd7a-c723b8d35416";
const clone = value => structuredClone(value);
function fixture() {
  const subscription = { organisationId: ORG, plan: clone(PREVIEW_TESTER_PLAN), status: "TRIAL", billingContract: null, currentPeriodEnd: EXPIRES,
    complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]) };
  const organisation = { id: ORG, subscription, enterpriseSecurityPolicy: null }, membership = { organisationId: ORG, role: "OWNER", organisation };
  const user = { id: USER, email: "retail@manuelchircop.com", role: "OWNER", memberships: [membership], privatePreviewAccess: {
    userId: USER, organisationId: ORG, pillars: ["RETAIL"], enabled: true, passwordEnabled: true, expiresAt: EXPIRES } };
  const session = { id: "retail-session", userId: USER, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, expiresAt: EXPIRES, revokedAt: null };
  const context = { user, session, membership, memberships: [membership] };
  const d = { reads: [], locks: [], writes: [], audits: new Map(), station: { id: STATION, organisationId: ORG, productFamily: "RETAIL", status: "DRAFT",
    publicPlayerEnabled: false, stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL" }, channels: [],
    promos: ["spot-a", "spot-b"].map((id, i) => ({ id, version: 1, status: "APPROVED", qcStatus: "PASSED", reviewedAt: BEFORE, updatedAt: BEFORE,
      durationSeconds: 30, promoAssetId: `promo-${i}`, mediaAssetId: `media-${i}`,
      promoAsset: { id: `promo-${i}`, name: `Spot ${i}`, organisationId: ORG, status: "ACTIVE", currentApprovedVersionId: id },
      mediaAsset: { id: `media-${i}`, organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: "READY", mimeType: "audio/mpeg", durationSeconds: 30, updatedAt: BEFORE } })) };
  const db = {
    station: { findFirst: async ({ where }) => { assert.deepEqual(where, { id: STATION, organisationId: ORG }); d.reads.push("station"); return clone(d.station); } },
    channel: { findMany: async ({ where, take }) => { assert.deepEqual(where, { stationId: STATION }); return clone(d.channels.slice(0, take)); } },
    user: { findUnique: async ({ where }) => ({ id: where.id, role: where.id === "admin" ? "SUPER_ADMIN" : "OWNER" }) },
    promoVersion: { findMany: async ({ where, select, take }) => { assert.equal(where.promoAsset.organisationId, ORG); assert.equal(where.mediaAsset.organisationId, ORG);
      assert.equal(select.mediaAsset.select.storageKey, undefined); d.reads.push("promos"); return clone(d.promos.slice(0, take)); } },
    auditLog: { findMany: async ({ where, take }) => { assert.equal(where.organisationId, ORG); assert.equal(where.entityId, STATION);
      return clone([...d.audits.values()].filter(row => row.entityType === where.entityType).slice(0, take)); },
      findUnique: async ({ where }) => clone(d.audits.get(where.id) || null),
      create: async ({ data }) => { assert.equal(d.audits.has(data.id), false); d.audits.set(data.id, clone(data)); d.writes.push(clone(data)); return clone(data); } },
    $executeRaw: async (_strings, ...values) => { d.locks.push(values); return 1; }
  };
  let tail = Promise.resolve();
  db.$transaction = async (operation, options) => { assert.equal(options.isolationLevel, "Serializable");
    let unlock; const current = new Promise(resolve => { unlock = resolve; }), previous = tail; tail = previous.then(() => current); await previous;
    const audits = clone(d.audits), writes = clone(d.writes);
    try { return await operation(db); } catch (error) { d.audits = audits; d.writes = writes; throw error; } finally { unlock(); } };
  const input = { action: "save", requestId: REQUEST, baseVersionId: null, name: "Retail commercial draft", timezone: "Europe/Malta", rules: [
    { name: "Every three songs", mode: "EVERY_SONGS", spotIds: ["spot-b", "spot-a"], weekdays: [1, 2, 3, 4, 5], everySongs: 3, endsOn: "2026-11-22" }] };
  return { d, db, context, options: { context, now: NOW }, input };
}
test("exact Retail subscriber scope is checked before any catalogue reads or writes", async () => {
  const f = fixture();
  for (const change of [c => { c.user.email = "radio@manuelchircop.com"; }, c => { c.session.activeOrganisationId = "foreign"; },
    c => { c.membership.role = "MANAGER"; }, c => { c.session.expiresAt = NOW; }, c => { c.user.privatePreviewAccess.expiresAt = NOW; }]) {
    const context = clone(f.context); change(context);
    await assert.rejects(retailCommercialDraft({}, { context, now: NOW }), { code: "RETAIL_COMMERCIAL_ACCESS_DENIED" });
    await assert.rejects(saveRetailCommercialDraft(f.db, { context, now: NOW, input: f.input }), { code: "RETAIL_COMMERCIAL_ACCESS_DENIED" });
  }
  assert.deepEqual(f.d.reads, []); assert.deepEqual(f.d.writes, []);
});
test("saved drafts are durable, ordered and unconnected to all live output controls", async () => {
  const f = fixture(), saved = await saveRetailCommercialDraft(f.db, { ...f.options, input: f.input });
  assert.equal(saved.draft.version, 1); assert.deepEqual(saved.draft.rules[0].spotIds, ["spot-b", "spot-a"]);
  assert.equal(saved.playbackConnected, false); assert.equal(saved.adminApprovalRequired, false); assert.equal(saved.draftOnly, true);
  assert.equal(saved.subscriberApprovalRequired, true); assert.equal(saved.scheduleApprovalRequired, "SUBSCRIBER");
  assert.equal(saved.draft.needsReview, false); assert.deepEqual((await retailCommercialDraft(f.db, f.options)).draft, saved.draft);
  assert.equal(f.d.writes.length, 1); assert.equal(f.d.writes[0].action, "TEST_RETAIL_COMMERCIAL_DRAFT_SAVED");
  assert.equal(saved.spots.some(spot => "fingerprint" in spot || "mediaAssetId" in spot || "storageKey" in spot), false);
  assert.equal(JSON.stringify(saved).includes("sourcePassword"), false);
});
test("identical retry creates nothing; changed retry and stale save cannot replace history", async () => {
  const f = fixture(), saved = await saveRetailCommercialDraft(f.db, { ...f.options, input: f.input });
  assert.equal((await saveRetailCommercialDraft(f.db, { ...f.options, input: f.input })).savedDraftId, saved.savedDraftId);
  assert.equal(f.d.writes.length, 1);
  await assert.rejects(saveRetailCommercialDraft(f.db, { ...f.options, input: { ...f.input, name: "Changed" } }), { code: "RETAIL_COMMERCIAL_RETRY_CHANGED" });
  await assert.rejects(saveRetailCommercialDraft(f.db, { ...f.options, input: { ...f.input, requestId: OTHER_REQUEST } }), { code: "RETAIL_COMMERCIAL_DRAFT_CHANGED" });
  const second = await saveRetailCommercialDraft(f.db, { ...f.options, input: { ...f.input, requestId: OTHER_REQUEST, baseVersionId: saved.savedDraftId, rules: [] } });
  assert.equal(second.draft.version, 2); assert.deepEqual(second.draft.rules, []); assert.equal(f.d.writes.length, 2);
  assert.equal(f.d.audits.get(saved.savedDraftId).details.draft.rules.length, 1);
});
test("concurrent saves use optimistic concurrency and only one new revision wins", async () => {
  const f = fixture();
  const results = await Promise.allSettled([saveRetailCommercialDraft(f.db, { ...f.options, input: f.input }),
    saveRetailCommercialDraft(f.db, { ...f.options, input: { ...f.input, requestId: OTHER_REQUEST, name: "Other draft" } })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.find(r => r.status === "rejected").reason.code, "RETAIL_COMMERCIAL_DRAFT_CHANGED");
  assert.equal(f.d.writes.length, 1);
});
test("foreign, unapproved, expired and changed audio cannot silently enter drafts", async () => {
  for (const mutate of [p => { p.promoAsset.organisationId = "foreign"; }, p => { p.mediaAsset.organisationId = "foreign"; },
    p => { p.status = "REJECTED"; }, p => { p.qcStatus = "FAILED"; }, p => { p.promoAsset.status = "ARCHIVED"; },
    p => { p.promoAsset.currentApprovedVersionId = "new-version"; }, p => { p.mediaAsset.status = "FAILED"; },
    p => { p.reviewedAt = EXPIRES; }, p => { p.mediaAsset.durationSeconds = 0; }]) {
    const f = fixture(); mutate(f.d.promos[0]);
    await assert.rejects(saveRetailCommercialDraft(f.db, { ...f.options, input: f.input }), { code: "RETAIL_COMMERCIAL_SPOT_UNAVAILABLE" });
    assert.equal(f.d.writes.length, 0);
  }
  const f = fixture(); await saveRetailCommercialDraft(f.db, { ...f.options, input: f.input });
  f.d.promos[0].mediaAsset.updatedAt = NOW;
  assert.deepEqual((await retailCommercialDraft(f.db, f.options)).draft.unavailableSpotIds, ["spot-a"]);
  const expired = { ...f.input, rules: [{ ...f.input.rules[0], endsOn: "2026-10-27" }] };
  await assert.rejects(saveRetailCommercialDraft(fixture().db, { ...f.options, input: expired }), { code: "RETAIL_COMMERCIAL_RULE_EXPIRED" });
});
test("read-only owner review is isolated and cannot approve unverified audio", async () => {
  const f = fixture(); await saveRetailCommercialDraft(f.db, { ...f.options, input: f.input });
  const owner = await retailCommercialOwnerReview(f.db, { actorUserId: "admin", organisationId: ORG, now: NOW });
  assert.equal(owner.canApprove, false); assert.equal(owner.reviewOnly, true); assert.equal(owner.draft.version, 1);
  for (const options of [{ actorUserId: USER, organisationId: ORG }, { actorUserId: "admin", organisationId: "foreign" }, { actorUserId: "admin", organisationId: ORG, stationId: "radio" }])
    await assert.rejects(retailCommercialOwnerReview(f.db, { ...options, now: NOW }), { code: "RETAIL_COMMERCIAL_ACCESS_DENIED" });
  assert.equal(f.d.writes.length, 1);
});
test("public errors never expose database or credential text", () => {
  assert.equal(retailCommercialPublicError(new Error("postgres://secret")).code, "RETAIL_COMMERCIAL_FAILED");
  assert.match(retailCommercialPublicError({ code: "RETAIL_COMMERCIAL_RULE_EXPIRED" }).error, /end date/);
});
