import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { uploadRetailCommercial } from "../lib/retail-commercial-upload-service.mjs";
import { reviewRetailSubscriberRecording, readRetailSubscriberRecordingForPreview, isRetailSubscriberUploadedRecording,
  reviewRetailUploadedRecordingAsAdmin } from "../lib/retail-commercial-subscriber-review.mjs";
import { normaliseRetailRecordingReview, readRetailRecordingReview, retailRecordingReviewError } from "../lib/retail-commercial-subscriber-review-request.mjs";

const NOW = new Date("2026-10-30T15:00:00Z"), EXPIRES = new Date("2026-11-23T13:00:00Z"), clone = structuredClone;
async function fixture() {
  const subscription = { organisationId: ORG, plan: clone(PREVIEW_TESTER_PLAN), status: "TRIAL", billingContract: null, currentPeriodEnd: EXPIRES,
    complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]) };
  const organisation = { id: ORG, subscription, enterpriseSecurityPolicy: null }, membership = { organisationId: ORG, role: "OWNER", organisation };
  const user = { id: "retail-user", email: "retail@manuelchircop.com", role: "OWNER", memberships: [membership], privatePreviewAccess: {
    userId: "retail-user", organisationId: ORG, pillars: ["RETAIL"], enabled: true, passwordEnabled: true, expiresAt: EXPIRES } };
  const session = { id: "retail-session", userId: user.id, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, expiresAt: EXPIRES, revokedAt: null };
  const context = { user, session, membership, memberships: [membership] };
  const d = { media: new Map(), promos: new Map(), versions: new Map(), audits: new Map(), next: 0, writes: 0, failAudit: false, failAssetCas: false };
  const media = where => [...d.media.values()].filter(row => row.organisationId === where.organisationId && row.libraryType === where.libraryType && where.status.in.includes(row.status));
  const version = row => row ? ({ ...clone(row), promoAsset: clone(d.promos.get(row.promoAssetId)), mediaAsset: clone(d.media.get(row.mediaAssetId)) }) : null;
  const db = {
    station: { findFirst: async () => ({ id: STATION, organisationId: ORG, productFamily: "RETAIL", status: "DRAFT", publicPlayerEnabled: false,
      stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL" }) }, channel: { findMany: async () => [] },
    mediaAsset: { aggregate: async ({ where }) => ({ _sum: { sizeBytes: media(where).reduce((sum, row) => sum + row.sizeBytes, 0n) } }),
      count: async ({ where }) => media(where).length,
      findUnique: async ({ where }) => clone([...d.media.values()].find(row => row.storageKey === where.storageKey) || null),
      create: async ({ data }) => { const row = { id: `media-${++d.next}`, createdAt: NOW, updatedAt: NOW, ...clone(data) }; d.media.set(row.id, row); d.writes++; return clone(row); },
      update: async ({ where, data }) => { const row = { ...d.media.get(where.id), ...clone(data) }; d.media.set(row.id, row); d.writes++; return clone(row); } },
    promoAsset: { create: async ({ data }) => { const row = { id: `promo-${++d.next}`, status: "ACTIVE", currentApprovedVersionId: null, ...clone(data) }; d.promos.set(row.id, row); d.writes++; return clone(row); },
      updateMany: async ({ where, data }) => { assert.equal(where.organisationId, ORG); const row = d.promos.get(where.id);
        if (d.failAssetCas || !row || row.currentApprovedVersionId !== where.currentApprovedVersionId) return { count: 0 };
        Object.assign(row, clone(data)); d.writes++; return { count: 1 }; } },
    promoVersion: { findMany: async ({ where }) => { assert.equal(where.promoAsset.organisationId, ORG); return [...d.versions.values()].map(version); },
      findFirst: async ({ where }) => { if (where.promoAsset) assert.equal(where.promoAsset.organisationId, ORG);
        if (where.mediaAsset) assert.equal(where.mediaAsset.organisationId, ORG);
        return version([...d.versions.values()].find(row => where.id ? row.id === where.id : row.mediaAssetId === where.mediaAssetId)); },
      create: async ({ data }) => { const row = { id: `version-${++d.next}`, reviewedAt: null, reviewedById: null, updatedAt: NOW, processingJobs: [], ...clone(data) };
        d.versions.set(row.id, row); d.writes++; return clone(row); },
      updateMany: async ({ where, data }) => { const row = d.versions.get(where.id);
        assert.equal(where.promoAsset.organisationId, ORG); assert.equal(where.mediaAsset.organisationId, ORG);
        if (!row || row.status !== where.status || row.qcStatus !== where.qcStatus || +row.updatedAt !== +where.updatedAt || row.reviewedAt !== where.reviewedAt || row.reviewedById !== where.reviewedById) return { count: 0 };
        Object.assign(row, clone(data)); d.writes++; return { count: 1 }; } },
    auditLog: { findUnique: async ({ where }) => clone(d.audits.get(where.id) || null), create: async ({ data }) => {
      if (d.failAudit) throw Error("synthetic audit failure"); assert.equal(d.audits.has(data.id), false); const row = { id: `audit-${++d.next}`, createdAt: NOW, ...clone(data) };
      d.audits.set(row.id, row); d.writes++; return clone(row); } },
    $executeRaw: async (_sql, ...values) => { assert.equal(values[0], `retail-commercial-upload:${ORG}`); return 1; }
  };
  let tail = Promise.resolve();
  db.$transaction = async (operation, options) => { assert.equal(options.isolationLevel, "Serializable"); let release;
    const gate = new Promise(resolve => { release = resolve; }), previous = tail; tail = previous.then(() => gate); await previous;
    const before = clone({ media: d.media, promos: d.promos, versions: d.versions, audits: d.audits, writes: d.writes, next: d.next });
    try { return await operation(db); } catch (error) { Object.assign(d, before); throw error; } finally { release(); } };
  const upload = await uploadRetailCommercial(db, { context, now: NOW, input: { name: "Our own opening hours", mediaType: "ANNOUNCEMENT", languageCode: "en",
    requestId: "31400821-cc19-4c1d-bd7a-c723b8d35415", rightsConfirmed: "true", fileName: "hours.mp3", claimedType: "audio/mpeg", buffer: Buffer.from("ID3abcdefghijklm") },
    storage: { put: async () => {}, remove: async () => {} }, measureDuration: async () => 30 });
  const row = [...d.versions.values()][0], promo = d.promos.get(row.promoAssetId), asset = d.media.get(row.mediaAssetId);
  return { db, d, context, row, promo, asset, upload, options: { context, now: NOW, input: { versionId: row.id, decision: "APPROVE", rightsConfirmed: true } } };
}

test("own prior uploads can be explicitly approved, audited and retried without live changes", async () => {
  const f = await fixture(), result = await reviewRetailSubscriberRecording(f.db, f.options);
  assert.equal(result.uploads[0].status, "APPROVED"); assert.equal(result.uploads[0].qcStatus, "PASSED");
  assert.equal(result.subscriberApprovalRequired, true); assert.equal(result.adminApprovalRequired, false); assert.equal(result.scheduleApprovalRequired, "SUBSCRIBER");
  assert.equal(result.playbackConnected, false); assert.equal(f.promo.currentApprovedVersionId, f.row.id);
  const audit = [...f.d.audits.values()].find(row => row.action === "TEST_RETAIL_SUBSCRIBER_RECORDING_APPROVED");
  assert.equal(audit.actorUserId, "retail-user"); assert.equal(audit.organisationId, ORG); assert.equal(audit.details.rightsConfirmed, true);
  assert.equal(audit.details.subscriberResponsible, true); assert.equal(audit.details.playbackChanged, false);
  const before = f.d.writes; assert.equal((await reviewRetailSubscriberRecording(f.db, f.options)).duplicate, true); assert.equal(f.d.writes, before);
  await assert.rejects(reviewRetailSubscriberRecording(f.db, { ...f.options, input: { versionId: f.row.id, decision: "REJECT", notes: "Changed" } }), { code: "RETAIL_RECORDING_REVIEW_CHANGED" });
  assert.equal(f.context.membership.organisation.subscription.plan.promoUploadEnabled, false);
});

test("rejection stays unavailable, does not select audio and cannot be turned into an approval", async () => {
  const f = await fixture(), input = { versionId: f.row.id, decision: "REJECT", notes: "Wrong shop telephone number" };
  const result = await reviewRetailSubscriberRecording(f.db, { ...f.options, input });
  assert.equal(result.uploads[0].status, "REJECTED"); assert.equal(f.promo.currentApprovedVersionId, null);
  assert.equal((await reviewRetailSubscriberRecording(f.db, { ...f.options, input })).duplicate, true);
  await assert.rejects(reviewRetailSubscriberRecording(f.db, f.options), { code: "RETAIL_RECORDING_REVIEW_CHANGED" });
});

test("cross-user, cross-organisation, catalogue and legacy admin recordings are denied before mutation", async () => {
  const changes = [f => { f.context.user.email = "radio@manuelchircop.com"; }, f => { f.context.session.activeOrganisationId = "foreign"; },
    f => { f.promo.organisationId = "foreign"; }, f => { f.asset.organisationId = "foreign"; },
    f => { f.asset.libraryType = "LICENSED_CATALOGUE"; }, f => { f.asset.licensedCatalogue = true; },
    f => { f.row.sourceReference = "admin-upload-123"; }, f => { f.row.sourceType = "STUDIO"; }];
  for (const change of changes) {
    const f = await fixture(); change(f); const before = f.d.writes;
    await assert.rejects(reviewRetailSubscriberRecording(f.db, f.options));
    await assert.rejects(readRetailSubscriberRecordingForPreview(f.db, { context: f.context, versionId: f.row.id, now: NOW }));
    assert.equal(f.d.writes, before);
  }
});

test("approval requires untampered measured upload receipts and no failed or unfinished processing", async () => {
  const changes = [f => { f.d.audits.delete(`${f.row.sourceReference}-complete`); },
    f => { f.d.audits.get(`${f.row.sourceReference}-complete`).details.durationSeconds = 2; },
    f => { f.d.audits.get(f.row.sourceReference).details.requestHash = "f".repeat(64); },
    f => { f.d.audits.get(`${f.row.sourceReference}-complete`).actorUserId = "foreign"; },
    f => { f.asset.storageKey = f.asset.storageKey.replace(/promos\//, "private/"); },
    f => { f.asset.durationSeconds = 40; }, f => { f.row.checksumSha256 = "f".repeat(64); },
    ...["FAILED", "RUNNING", "QUEUED", "CANCELLED"].map(status => f => { f.row.processingJobs = [{ status }]; })];
  for (const change of changes) { const f = await fixture(); change(f); const before = f.d.writes;
    await assert.rejects(reviewRetailSubscriberRecording(f.db, f.options), { code: "RETAIL_RECORDING_REVIEW_VALIDATION_REQUIRED" }); assert.equal(f.d.writes, before); }
});

test("review cannot overwrite existing approval or reopen admin-rejected or superseded recordings", async () => {
  for (const change of [f => { f.promo.currentApprovedVersionId = "already-selected"; }, f => { f.row.status = "SUPERSEDED"; },
    f => { f.row.status = "REJECTED"; f.row.reviewedById = "admin"; }, f => { f.row.qcStatus = "FAILED"; }]) {
    const f = await fixture(); change(f); const before = f.d.writes;
    await assert.rejects(reviewRetailSubscriberRecording(f.db, f.options), { code: "RETAIL_RECORDING_REVIEW_CHANGED" }); assert.equal(f.d.writes, before);
  }
});

test("simultaneous decisions serialize and failed audit or approved-pointer CAS rolls back all changes", async () => {
  const f = await fixture(); const settled = await Promise.allSettled([reviewRetailSubscriberRecording(f.db, f.options),
    reviewRetailSubscriberRecording(f.db, { ...f.options, input: { versionId: f.row.id, decision: "REJECT", notes: "Wrong version" } })]);
  assert.equal(settled.filter(row => row.status === "fulfilled").length, 1);
  for (const flag of ["failAudit", "failAssetCas"]) { const g = await fixture(); g.d[flag] = true; const before = g.d.writes;
    await assert.rejects(reviewRetailSubscriberRecording(g.db, g.options));
    assert.equal(g.d.versions.get(g.row.id).status, "IN_REVIEW"); assert.equal(g.d.promos.get(g.promo.id).currentApprovedVersionId, null); assert.equal(g.d.writes, before);
  }
});

test("private preview resolves only verified pending or currently approved own audio", async () => {
  const f = await fixture(); const preview = await readRetailSubscriberRecordingForPreview(f.db, { context: f.context, versionId: f.row.id, now: NOW });
  assert.equal(preview.sizeBytes, 16); assert.equal(preview.durationSeconds, 30); assert.ok(preview.storageKey.startsWith(`organisations/${ORG}/promos/announcement/`));
  assert.equal(preview.url, undefined); await reviewRetailSubscriberRecording(f.db, f.options);
  assert.equal((await readRetailSubscriberRecordingForPreview(f.db, { context: f.context, versionId: f.row.id, now: NOW })).versionId, f.row.id);
  f.promo.currentApprovedVersionId = "new-version";
  await assert.rejects(readRetailSubscriberRecordingForPreview(f.db, { context: f.context, versionId: f.row.id, now: NOW }), { code: "RETAIL_RECORDING_REVIEW_CHANGED" });
});

test("an old administrator screen cannot overwrite a subscriber's newer rejection", async () => {
  const f = await fixture(), oldSnapshot = { ...clone(f.row), promoAsset: clone(f.promo) };
  assert.equal(isRetailSubscriberUploadedRecording(oldSnapshot), true);
  await reviewRetailSubscriberRecording(f.db, { ...f.options, input: { versionId: f.row.id, decision: "REJECT", notes: "Incorrect message" } });
  const before = f.d.writes;
  await assert.rejects(reviewRetailUploadedRecordingAsAdmin(f.db, { promoAssetId: oldSnapshot.promoAssetId, promoVersionId: oldSnapshot.id,
    actorId: "owner-admin", decision: "APPROVE", now: NOW }), { code: "RETAIL_RECORDING_REVIEW_CHANGED" });
  assert.equal(f.d.versions.get(f.row.id).status, "REJECTED"); assert.equal(f.d.promos.get(f.promo.id).currentApprovedVersionId, null); assert.equal(f.d.writes, before);
  assert.equal(isRetailSubscriberUploadedRecording({ ...oldSnapshot, promoAsset: { ...oldSnapshot.promoAsset, organisationId: "other-org" } }), false);
  assert.equal(isRetailSubscriberUploadedRecording({ ...oldSnapshot, sourceReference: "legacy-admin-upload" }), false);
});

test("administrator and subscriber opposing reviews share the same lock and cannot both commit", async () => {
  for (const adminFirst of [true, false]) {
    const f = await fixture(), admin = () => reviewRetailUploadedRecordingAsAdmin(f.db, { promoAssetId: f.promo.id, promoVersionId: f.row.id,
      actorId: "owner-admin", decision: "APPROVE", now: NOW }), subscriber = () => reviewRetailSubscriberRecording(f.db, {
        ...f.options, input: { versionId: f.row.id, decision: "REJECT", notes: "Wrong message" } });
    const settled = await Promise.allSettled((adminFirst ? [admin, subscriber] : [subscriber, admin]).map(run => run()));
    assert.equal(settled.filter(row => row.status === "fulfilled").length, 1);
    const final = f.d.versions.get(f.row.id), promo = f.d.promos.get(f.promo.id);
    const adminWon = settled[adminFirst ? 0 : 1].status === "fulfilled";
    assert.equal(final.status, adminWon ? "APPROVED" : "REJECTED"); assert.equal(promo.currentApprovedVersionId, adminWon ? final.id : null);
  }
});

const request = (body, headers = {}) => new Request("https://www.ruvanas.com/api/programming/test-retail/commercial-audio/review", {
  method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "application/json", ...headers }, body });
test("review request enforces explicit rights, rejection notes, exact keys, origin and bounded bytes", async () => {
  const good = { versionId: "version-123", decision: "APPROVE", rightsConfirmed: true };
  assert.equal((await readRetailRecordingReview(request(JSON.stringify(good)))).decision, "APPROVE");
  for (const input of [{ ...good, organisationId: ORG }, { ...good, rightsConfirmed: "true" }, { ...good, rightsConfirmed: false },
    { versionId: "v", decision: "REJECT", notes: " " }, { ...good, notes: "a".repeat(1001) }]) assert.throws(() => normaliseRetailRecordingReview(input));
  await assert.rejects(readRetailRecordingReview(request(JSON.stringify(good), { origin: "https://foreign.invalid" })), { code: "RETAIL_RECORDING_REVIEW_ACCESS_DENIED" });
  await assert.rejects(readRetailRecordingReview(request("a".repeat(8193))));
  await assert.rejects(readRetailRecordingReview(request(JSON.stringify(good), { "content-length": "2" })));
  const controller = new AbortController(), slow = new Request("https://www.ruvanas.com/api/programming/test-retail/commercial-audio/review", {
    method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "application/json" }, body: new ReadableStream({ start() {} }), duplex: "half", signal: controller.signal });
  await assert.rejects(readRetailRecordingReview(slow, { timeoutMs: 5 }), { code: "RETAIL_RECORDING_REVIEW_TIMEOUT" }); controller.abort();
  assert.equal(retailRecordingReviewError(Error("secret details")).error.includes("secret"), false);
});
