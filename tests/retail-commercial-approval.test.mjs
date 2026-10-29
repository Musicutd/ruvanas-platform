import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { reviewRetailCommercialApproval, approveRetailCommercialDraft, loadRetailCommercialSchedule, retailCommercialApprovalError } from "../lib/retail-commercial-approval.mjs";

const BEFORE = new Date("2026-10-28T09:00:00Z"), NOW = new Date("2026-10-29T10:00:00Z");
const REQUEST = "31400821-cc19-4c1d-bd7a-c723b8d35415", SECOND = "31400821-cc19-4c1d-bd7a-c723b8d35416";
const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex"), clone = structuredClone;
const actor = { actorUserId: "admin", organisationId: ORG, now: NOW };
function fixture() {
  const d = { audits: new Map(), writes: [], reads: [], adminRole: "SUPER_ADMIN", station: { id: STATION, organisationId: ORG, productFamily: "RETAIL" },
    rows: ["a", "b"].map((s, i) => ({ id: `spot-${s}`, version: 1, status: "APPROVED", qcStatus: "PASSED", reviewedAt: BEFORE, updatedAt: BEFORE,
      durationSeconds: 30, checksumSha256: s.repeat(64), promoAssetId: `promo-${s}`, mediaAssetId: `media-${s}`,
      promoAsset: { id: `promo-${s}`, name: `Retail spot ${s}`, organisationId: ORG, status: "ACTIVE", currentApprovedVersionId: `spot-${s}` },
      mediaAsset: { id: `media-${s}`, organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: "READY", mimeType: "audio/mpeg", mediaType: "COMMERCIAL",
        durationSeconds: 30, updatedAt: BEFORE, storageKey: `organisations/${ORG}/promos/commercial/${s.repeat(64)}.mp3`, sizeBytes: 12345n } })) };
  const fingerprint = row => hash([row.id, row.version, row.promoAssetId, row.mediaAssetId, row.reviewedAt.toISOString(), row.updatedAt.toISOString(), row.mediaAsset.updatedAt.toISOString(), row.durationSeconds]);
  const draft = (version = 1, rules = [{ name: "Every three songs", mode: "EVERY_SONGS", spotIds: ["spot-b", "spot-a"], weekdays: [1, 2, 3, 4, 5], everySongs: 3 }]) => {
    const id = `retail-commercial-${hash(version).slice(0, 40)}`, selected = new Set(rules.flatMap(rule => rule.spotIds));
    d.audits.set(id, { id, organisationId: ORG, entityId: STATION, actorUserId: "retail-user", entityType: "RetailCommercialDraft", action: "TEST_RETAIL_COMMERCIAL_DRAFT_SAVED", createdAt: BEFORE,
      details: { stationId: STATION, version, requestHash: hash(version), draft: { name: `Commercial draft ${version}`, timezone: "Europe/Malta", rules },
        spots: d.rows.filter(r => selected.has(r.id)).map(r => ({ id: r.id, fingerprint: fingerprint(r) })) } });
    return id;
  };
  const db = {
    user: { findUnique: async ({ where }) => { d.reads.push("user"); return { id: where.id, role: where.id === "admin" ? d.adminRole : "OWNER" }; } },
    station: { findFirst: async ({ where }) => { assert.deepEqual(where, { id: STATION, organisationId: ORG }); d.reads.push("station"); return clone(d.station); } },
    promoVersion: { findMany: async ({ where, select, take }) => {
      assert.equal(where.promoAsset.organisationId, ORG); assert.equal(where.mediaAsset.organisationId, ORG); d.reads.push(select.checksumSha256 ? "media" : "metadata");
      return clone(d.rows.filter(row => !where.id || where.id.in.includes(row.id)).slice(0, take));
    } },
    auditLog: {
      findMany: async ({ where, take }) => { assert.equal(where.organisationId, ORG); assert.equal(where.entityId, STATION); d.reads.push(where.entityType);
        return clone([...d.audits.values()].filter(row => row.entityType === where.entityType && row.action === where.action).slice(0, take)); },
      findUnique: async ({ where }) => clone(d.audits.get(where.id) || null),
      create: async ({ data }) => { assert.equal(d.audits.has(data.id), false); d.audits.set(data.id, clone(data)); d.writes.push(clone(data)); return clone(data); }
    },
    $executeRaw: async (_strings, ...args) => { assert.deepEqual(args, [`retail-commercial-drafts:${STATION}`]); return 1; }
  };
  let tail = Promise.resolve();
  db.$transaction = async (fn, options) => {
    assert.equal(options.isolationLevel, "Serializable"); let unlock;
    const current = new Promise(resolve => { unlock = resolve; }), previous = tail; tail = previous.then(() => current); await previous;
    const audits = clone(d.audits), writes = clone(d.writes);
    try { return await fn(db); } catch (error) { d.audits = audits; d.writes = writes; throw error; } finally { unlock(); }
  };
  const authorized = { station: d.station, grant: { action: "START", id: "playout-grant", stationId: STATION, organisationId: ORG, issuedAt: BEFORE.toISOString() }, tracks: [] };
  draft();
  const review = () => reviewRetailCommercialApproval(db, actor);
  const approve = async (extra = {}) => { const r = await review(); return approveRetailCommercialDraft(db, { ...actor, draftId: r.draft.id, reviewHash: r.reviewHash,
    baseApprovalId: r.baseApprovalId, requestId: REQUEST, ...extra }); };
  const load = (extra = {}) => loadRetailCommercialSchedule(db, { authorized, now: NOW, ...extra });
  return { db, d, draft, authorized, review, approve, load };
}

test("only the exact Retail owner may review or approve; reads do not mutate anything", async () => {
  const f = fixture();
  for (const delta of [{ organisationId: "foreign" }, { stationId: "radio" }, { actorUserId: "retail-user" }]) {
    await assert.rejects(reviewRetailCommercialApproval(f.db, { ...actor, ...delta }), { code: "RETAIL_COMMERCIAL_ACCESS_DENIED" });
  }
  const review = await f.review();
  assert.equal(review.canApprove, true); assert.equal(review.reviewOnly, true); assert.equal(review.approval, null);
  assert.equal(review.spots.length, 2); assert.equal(review.draft.version, 1); assert.equal(f.d.writes.length, 0);
  for (const privateText of ["storageKey", "checksumSha256", "mediaAssetId", "fingerprint", "sizeBytes"]) assert.equal(JSON.stringify(review).includes(privateText), false);
  assert.equal((await f.load()).reasonCode, "RETAIL_COMMERCIAL_NOT_APPROVED");
});

test("explicit approval creates one immutable record and the worker loads only those approved spots", async () => {
  const f = fixture(), result = await f.approve(), active = await f.load();
  assert.equal(result.accepted, true); assert.equal(result.canApprove, false); assert.equal(result.approvedDraftId, result.draft.id);
  assert.equal(f.d.writes.length, 1); assert.equal(active.enabled, true); assert.equal(active.rules[0].name, "Every three songs");
  assert.equal(active.effectiveAt, NOW.toISOString()); assert.equal(active.validUntil, "2026-10-29T10:00:15.000Z");
  assert.equal(active.spots[0].contentKind, "COMMERCIAL"); assert.equal(active.spots[0].track.id, active.spots[0].id);
  assert.equal(active.spots[0].track.mediaAsset.organisationId, ORG); assert.equal(active.spots[0].track.mediaAsset.checksumSha256, "a".repeat(64));
  assert.equal(JSON.stringify(f.d.writes[0]).includes("storageKey"), false);
});

test("a subscriber's newer draft never changes the worker's approved rules", async () => {
  const f = fixture(); await f.approve(); const first = await f.load();
  f.draft(2, [{ name: "Every minute", mode: "EVERY_MINUTES", spotIds: ["spot-a"], weekdays: [1], everyMinutes: 1 }]);
  const newer = await f.review(), still = await f.load();
  assert.equal(newer.draft.version, 2); assert.equal(newer.canApprove, true); assert.equal(still.revisionFingerprint, first.revisionFingerprint);
  assert.equal(still.rules[0].mode, "EVERY_SONGS");
});

test("approval review CAS rejects changed drafts, concurrent approvals and changed media identity", async () => {
  const f = fixture(), reviewed = await f.review(), command = { ...actor, draftId: reviewed.draft.id, reviewHash: reviewed.reviewHash, baseApprovalId: null, requestId: REQUEST };
  f.draft(2);
  await assert.rejects(approveRetailCommercialDraft(f.db, command), { code: "RETAIL_COMMERCIAL_REVIEW_CHANGED" });
  const g = fixture(), r = await g.review(), input = { ...actor, draftId: r.draft.id, reviewHash: r.reviewHash, baseApprovalId: null };
  const settled = await Promise.allSettled([approveRetailCommercialDraft(g.db, { ...input, requestId: REQUEST }), approveRetailCommercialDraft(g.db, { ...input, requestId: SECOND })]);
  assert.equal(settled.filter(s => s.status === "fulfilled").length, 1); assert.equal(g.d.writes.length, 1);
  assert.equal(settled.find(s => s.status === "rejected").reason.code, "RETAIL_COMMERCIAL_REVIEW_CHANGED");
  const h = fixture(), m = await h.review(); h.d.rows[0].mediaAsset.sizeBytes += 1n;
  await assert.rejects(approveRetailCommercialDraft(h.db, { ...actor, draftId: m.draft.id, reviewHash: m.reviewHash, baseApprovalId: null, requestId: REQUEST }), { code: "RETAIL_COMMERCIAL_REVIEW_CHANGED" });
});

test("identical command retries cannot resurrect an old approval after an approved disable", async () => {
  const f = fixture(), review = await f.review(), command = { ...actor, draftId: review.draft.id, reviewHash: review.reviewHash, baseApprovalId: null, requestId: REQUEST };
  const first = await approveRetailCommercialDraft(f.db, command);
  assert.equal((await approveRetailCommercialDraft(f.db, command)).replayed, true); assert.equal(f.d.writes.length, 1);
  await assert.rejects(approveRetailCommercialDraft(f.db, { ...command, reviewHash: "c".repeat(64) }), { code: "RETAIL_COMMERCIAL_RETRY_CHANGED" });
  f.draft(2, []); const off = await f.approve({ requestId: SECOND });
  assert.equal((await f.load()).reasonCode, "RETAIL_COMMERCIAL_APPROVED_OFF");
  const retry = await approveRetailCommercialDraft(f.db, command);
  assert.equal(retry.approvedRevision.id, first.approval.id); assert.equal(retry.activeApprovalId, off.approval.id);
  assert.equal(retry.approval.id, off.approval.id); assert.equal((await f.load()).enabled, false); assert.equal(f.d.writes.length, 2);
});

test("current owner, exact tenant, private audio and unchanged fingerprints are required on every load", async () => {
  for (const change of [f => { f.d.adminRole = "OWNER"; }, f => { f.d.rows[0].status = "REJECTED"; },
    f => { f.d.rows[0].mediaAsset.organisationId = "foreign"; }, f => { f.d.rows[0].promoAsset.currentApprovedVersionId = "replacement"; },
    f => { f.d.rows[0].mediaAsset.sizeBytes += 1n; }, f => { f.d.rows[0].mediaAsset.updatedAt = NOW; },
    f => { f.d.rows[0].checksumSha256 = "f".repeat(64); }, f => { f.d.rows[0].mediaAsset.storageKey = "catalogue/music/" + "a".repeat(64) + ".mp3"; }]) {
    const f = fixture(); await f.approve(); change(f); assert.equal((await f.load()).enabled, false);
  }
  const f = fixture(); await f.approve();
  for (const delta of [{ station: { ...f.d.station, id: "radio" } }, { grant: { ...f.authorized.grant, action: "STOP" } },
    { grant: { ...f.authorized.grant, organisationId: "foreign" } }, { grant: { ...f.authorized.grant, issuedAt: "2027-01-01T00:00:00Z" } }]) {
    f.d.reads.length = 0; assert.equal((await f.load({ authorized: { ...f.authorized, ...delta } })).reasonCode, "RETAIL_COMMERCIAL_SCOPE_INVALID");
    assert.equal(f.d.reads.length, 0);
  }
});

test("corrupted, future or truncated audit histories fail closed without changing music", async () => {
  for (const change of [f => { f.d.writes[0].details.sequence = 9; f.d.audits.set(f.d.writes[0].id, f.d.writes[0]); },
    f => { const a = [...f.d.audits.values()].find(x => x.entityType === "RetailCommercialApproval"); a.details.baseApprovalId = a.id; },
    f => { const a = [...f.d.audits.values()].find(x => x.entityType === "RetailCommercialApproval"); a.createdAt = new Date("2027-01-01"); },
    f => { const d = [...f.d.audits.values()].find(x => x.entityType === "RetailCommercialDraft"); d.details.draft.rules[0].everySongs = 1; }]) {
    const f = fixture(); await f.approve(); change(f); assert.equal((await f.load()).enabled, false); assert.equal(f.d.writes.length, 1);
  }
  const f = fixture(); await f.approve(); f.db.auditLog.findMany = async () => { throw new Error("postgresql://secret"); };
  assert.deepEqual(await f.load(), { enabled: false, reasonCode: "RETAIL_COMMERCIAL_UNAVAILABLE", rules: [], spots: [] });
  assert.equal(JSON.stringify(retailCommercialApprovalError(new Error("storage-key-secret"))).includes("storage-key-secret"), false);
});

test("expired dates and missing checksums block approval, while an empty draft can explicitly disable spots", async () => {
  const expired = fixture();
  expired.draft(2, [{ name: "Ended campaign", mode: "TOP_OF_HOUR", spotIds: ["spot-a"], weekdays: [4], hours: [10], endsOn: "2026-10-28" }]);
  const stale = await expired.review(); assert.equal(stale.canApprove, false); assert.equal(stale.reviewHash, null);
  assert.match(stale.warnings.join(" "), /date range has ended/); assert.equal(expired.d.writes.length, 0);
  const missing = fixture(); missing.d.rows[0].checksumSha256 = null;
  const denied = await missing.review(); assert.equal(denied.canApprove, false); assert.match(denied.warnings.join(" "), /verified audio/);
  missing.draft(2, []); const off = await missing.approve();
  assert.equal(off.accepted, true); assert.equal((await missing.load()).reasonCode, "RETAIL_COMMERCIAL_APPROVED_OFF");
});
