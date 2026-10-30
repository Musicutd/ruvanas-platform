import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { uploadRetailCommercial, retailCommercialUploads } from "../lib/retail-commercial-upload-service.mjs";
import { retailCommercialMediaIdentity } from "../lib/retail-commercial-media.mjs";
import { RETAIL_COMMERCIAL_UPLOAD_LIMITS as LIMITS } from "../lib/retail-commercial-upload-request.mjs";
import { retailCommercialUploadView } from "../lib/retail-commercial-upload-ui.mjs";

const NOW = new Date("2026-10-30T15:00:00Z"), EXPIRES = new Date("2026-11-23T13:00:00Z"), clone = structuredClone;
const UUID = "31400821-cc19-4c1d-bd7a-c723b8d35415", OTHER = "31400821-cc19-4c1d-bd7a-c723b8d35416";
function fixture() {
  const subscription = { organisationId: ORG, plan: clone(PREVIEW_TESTER_PLAN), status: "TRIAL", billingContract: null, currentPeriodEnd: EXPIRES,
    complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]) };
  const organisation = { id: ORG, subscription, enterpriseSecurityPolicy: null }, membership = { organisationId: ORG, role: "OWNER", organisation };
  const user = { id: "retail-user", email: "retail@manuelchircop.com", role: "OWNER", memberships: [membership], privatePreviewAccess: {
    userId: "retail-user", organisationId: ORG, pillars: ["RETAIL"], enabled: true, passwordEnabled: true, expiresAt: EXPIRES } };
  const session = { id: "retail-session", userId: user.id, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, expiresAt: EXPIRES, revokedAt: null };
  const context = { user, session, membership, memberships: [membership] };
  const d = { media: new Map(), promos: new Map(), versions: new Map(), audits: new Map(), objects: new Map(), puts: [], removes: [], writes: [], next: 0,
    extraBytes: 0n, extraCount: 0, failVersion: false, failPut: false, failRemove: false, loseCommit: false };
  const selected = where => [...d.media.values()].filter(x => x.organisationId === where.organisationId && x.libraryType === where.libraryType && where.status.in.includes(x.status));
  const version = row => ({ ...clone(row), promoAsset: clone(d.promos.get(row.promoAssetId)), mediaAsset: clone(d.media.get(row.mediaAssetId)) });
  const versions = where => { assert.equal(where.promoAsset.organisationId, ORG); assert.equal(where.mediaAsset.organisationId, ORG);
    return [...d.versions.values()].filter(v => (!where.mediaAssetId || v.mediaAssetId === where.mediaAssetId) &&
      d.promos.get(v.promoAssetId).organisationId === ORG && d.media.get(v.mediaAssetId).status === "READY").map(version); };
  const db = {
    station: { findFirst: async () => ({ id: STATION, organisationId: ORG, productFamily: "RETAIL", status: "DRAFT", publicPlayerEnabled: false,
      stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL" }) }, channel: { findMany: async () => [] },
    mediaAsset: {
      aggregate: async ({ where }) => ({ _sum: { sizeBytes: selected(where).reduce((s, x) => s + x.sizeBytes, d.extraBytes) } }),
      count: async ({ where }) => selected(where).length + d.extraCount,
      findUnique: async ({ where }) => clone([...d.media.values()].find(x => where.storageKey ? x.storageKey === where.storageKey : x.id === where.id) || null),
      create: async ({ data }) => { const value = { id: `media-${++d.next}`, ...clone(data) }; d.media.set(value.id, value); d.writes.push("media.create"); return clone(value); },
      update: async ({ where, data }) => { const value = { ...d.media.get(where.id), ...clone(data) }; d.media.set(value.id, value); d.writes.push("media.update"); return clone(value); }
    },
    promoAsset: { create: async ({ data }) => { const value = { id: `promo-${++d.next}`, status: "ACTIVE", currentApprovedVersionId: null, ...clone(data) };
      d.promos.set(value.id, value); d.writes.push("promo.create"); return clone(value); } },
    promoVersion: { findMany: async ({ where, take }) => versions(where).slice(0, take), findFirst: async ({ where }) => where.promoAsset ? versions(where)[0] || null :
      clone([...d.versions.values()].find(row => row.mediaAssetId === where.mediaAssetId) || null),
      create: async ({ data }) => { if (d.failVersion) throw Error("database failure"); const value = { id: `version-${++d.next}`, ...clone(data) };
        d.versions.set(value.id, value); d.writes.push("version.create"); return clone(value); } },
    auditLog: { findUnique: async ({ where }) => clone(d.audits.get(where.id) || null), create: async ({ data }) => {
      assert.equal(d.audits.has(data.id), false); d.audits.set(data.id, clone(data)); d.writes.push("audit.create"); return clone(data); } },
    $executeRaw: async (_strings, ...values) => { assert.equal(values[0], `retail-commercial-upload:${ORG}`); return 1; }
  };
  let tail = Promise.resolve();
  db.$transaction = async (operation, options) => { assert.equal(options.isolationLevel, "Serializable");
    let unlock; const gate = new Promise(resolve => { unlock = resolve; }), old = tail; tail = old.then(() => gate); await old;
    const saved = Object.fromEntries(["media", "promos", "versions", "audits", "writes", "next"].map(key => [key, clone(d[key])]));
    let committed = false;
    try { const result = await operation(db); committed = true; if (d.loseCommit && d.versions.size) { d.loseCommit = false; throw Error("response lost after commit"); } return result; }
    catch (error) { if (!committed) Object.assign(d, saved); throw error; } finally { unlock(); }
  };
  const storage = { put: async (key, bytes, type, checksum) => { d.puts.push({ key, type, checksum }); d.objects.set(key, Buffer.from(bytes)); if (d.failPut) throw Error("storage failed"); },
    remove: async key => { d.removes.push(key); if (d.failRemove) throw Error("cleanup failed"); d.objects.delete(key); } };
  const input = { name: "Opening hours", mediaType: "ANNOUNCEMENT", languageCode: "en", requestId: UUID, rightsConfirmed: "true",
    fileName: "hours.mp3", claimedType: "audio/mpeg", buffer: Buffer.from("ID3abcdefghijklm") };
  return { d, db, context, input, options: { context, input, now: NOW, storage, measureDuration: async () => 30 } };
}
test("subscriber uploads create measured private review-only recordings compatible with worker identity", async () => {
  const f = fixture(), result = await uploadRetailCommercial(f.db, f.options), row = result.uploads[0];
  assert.equal(result.organisationId, ORG); assert.equal(result.stationId, STATION); assert.equal(result.playbackConnected, false);
  assert.equal(row.status, "IN_REVIEW"); assert.equal(row.qcStatus, "PENDING"); assert.equal(row.durationSeconds, 30);
  assert.equal(row.submittedAt, NOW.toISOString()); assert.equal(row.reviewedAt, null); assert.equal(result.adminApprovalRequired, true);
  const media = [...f.d.media.values()][0], promo = [...f.d.promos.values()][0], v = [...f.d.versions.values()][0];
  assert.equal(media.licensedCatalogue, false); assert.equal(promo.currentApprovedVersionId, null); assert.equal(v.submittedById, "retail-user");
  assert.equal(retailCommercialMediaIdentity({ ...media, checksumSha256: v.checksumSha256 }).sizeBytes, f.input.buffer.length);
  for (const forbidden of ["storageKey", "checksumSha256", "previewUrl", "reviewedById", "sourcePassword"])
    assert.equal(JSON.stringify(result).includes(forbidden), false);
  assert.equal(f.context.membership.organisation.subscription.plan.promoUploadEnabled, false);
  const view = retailCommercialUploadView(result); assert.equal(view.uploads[0].name, "Opening hours");
  assert.equal(view.usedBytes, f.input.buffer.length); assert.equal(view.storageLimitBytes, LIMITS.maxStorageBytes);
});
test("foreign account, expired or changed membership is denied before storage and probe", async () => {
  for (const change of [c => { c.user.email = "radio@manuelchircop.com"; }, c => { c.session.activeOrganisationId = "foreign"; },
    c => { c.membership.role = "MANAGER"; }, c => { c.session.expiresAt = NOW; }]) {
    const f = fixture(); change(f.context); let probed = false;
    await assert.rejects(uploadRetailCommercial(f.db, { ...f.options, measureDuration: async () => { probed = true; return 30; } }), { code: "RETAIL_COMMERCIAL_UPLOAD_ACCESS_DENIED" });
    assert.equal(probed, false); assert.equal(f.d.puts.length, 0); assert.equal(f.d.writes.length, 0);
  }
});
test("server rejects disguised files, client duration, missing rights and excessive measured lengths", async () => {
  for (const change of [i => { i.buffer = Buffer.from("not audio whatsoever"); }, i => { i.fileName = "hours.exe"; },
    i => { i.durationSeconds = 10; }, i => { i.rightsConfirmed = "false"; }, i => { i.organisationId = "foreign"; }]) {
    const f = fixture(); change(f.input); await assert.rejects(uploadRetailCommercial(f.db, f.options)); assert.equal(f.d.puts.length, 0);
  }
  for (const duration of [0, 301, NaN, 30.2]) { const f = fixture(); await assert.rejects(uploadRetailCommercial(f.db, { ...f.options,
    measureDuration: async () => duration }), { code: "RETAIL_COMMERCIAL_UPLOAD_DURATION_INVALID" }); assert.equal(f.d.writes.length, 0); }
});
test("same bytes and request retries do not create duplicates or overwrite existing recordings", async () => {
  const f = fixture(), first = await uploadRetailCommercial(f.db, f.options);
  const again = await uploadRetailCommercial(f.db, f.options); assert.equal(again.uploadedId, first.uploadedId); assert.equal(again.duplicate, true);
  const duplicate = await uploadRetailCommercial(f.db, { ...f.options, input: { ...f.input, requestId: OTHER } });
  assert.equal(duplicate.uploadedId, first.uploadedId); assert.equal(f.d.puts.length, 1); assert.equal(f.d.versions.size, 1);
  await assert.rejects(uploadRetailCommercial(f.db, { ...f.options, input: { ...f.input, name: "Different" } }), { code: "RETAIL_COMMERCIAL_UPLOAD_RETRY_CHANGED" });
  await assert.rejects(uploadRetailCommercial(f.db, { ...f.options, input: { ...f.input, requestId: OTHER, name: "Changed duplicate" } }), { code: "RETAIL_COMMERCIAL_UPLOAD_RETRY_CHANGED" });
  assert.equal(f.d.removes.length, 0);
});
test("capacity reservations prevent simultaneous uploads exceeding existing pilot quota", async () => {
  const f = fixture(); f.d.extraBytes = BigInt(LIMITS.maxStorageBytes - f.input.buffer.length);
  const second = { ...f.input, requestId: OTHER, buffer: Buffer.from("ID3differentabcd") };
  const result = await Promise.allSettled([uploadRetailCommercial(f.db, f.options), uploadRetailCommercial(f.db, { ...f.options, input: second })]);
  assert.equal(result.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(result.find(x => x.status === "rejected").reason.code, "RETAIL_COMMERCIAL_UPLOAD_STORAGE_LIMIT"); assert.equal(f.d.puts.length, 1);
  const full = fixture(); full.d.extraCount = 50;
  await assert.rejects(uploadRetailCommercial(full.db, full.options), { code: "RETAIL_COMMERCIAL_UPLOAD_UPLOAD_LIMIT" });
  assert.equal((await retailCommercialUploads(full.db, full.options)).canUpload, false);
});
test("storage and rolled-back database failures clean only the new object; retries remain possible", async () => {
  for (const key of ["failPut", "failVersion"]) {
    const f = fixture(); f.d[key] = true;
    await assert.rejects(uploadRetailCommercial(f.db, f.options), { code: "RETAIL_COMMERCIAL_UPLOAD_STORAGE_FAILED" });
    assert.equal(f.d.objects.size, 0); assert.equal(f.d.versions.size, 0); assert.equal([...f.d.media.values()][0].status, "REJECTED");
    f.d[key] = false; const result = await uploadRetailCommercial(f.db, f.options); assert.equal(result.uploads[0].status, "IN_REVIEW");
  }
});
test("uncertain cleanup keeps capacity reserved; lost postcommit response never deletes ready audio", async () => {
  const f = fixture(); f.d.failPut = true; f.d.failRemove = true;
  await assert.rejects(uploadRetailCommercial(f.db, f.options), { code: "RETAIL_COMMERCIAL_UPLOAD_STORAGE_REVIEW" });
  assert.equal([...f.d.media.values()][0].status, "UPLOADING"); assert.equal((await retailCommercialUploads(f.db, f.options)).usedBytes, f.input.buffer.length);
  await assert.rejects(uploadRetailCommercial(f.db, f.options), { code: "RETAIL_COMMERCIAL_UPLOAD_BUSY" });
  const g = fixture(); g.d.loseCommit = true; const saved = await uploadRetailCommercial(g.db, g.options);
  assert.equal(saved.uploads.length, 1); assert.equal(g.d.objects.size, 1); assert.equal(g.d.removes.length, 0);
});
test("re-upload cannot reactivate rejected media referenced by an existing promo approval", async () => {
  const f = fixture(); await uploadRetailCommercial(f.db, f.options);
  const asset = [...f.d.media.values()][0]; asset.status = "REJECTED";
  const priorWrites = f.d.writes.length;
  await assert.rejects(uploadRetailCommercial(f.db, { ...f.options, input: { ...f.input, requestId: OTHER } }), { code: "RETAIL_COMMERCIAL_UPLOAD_STORAGE_REVIEW" });
  assert.equal(f.d.puts.length, 1); assert.equal(f.d.writes.length, priorWrites); assert.equal(asset.status, "REJECTED");
});
function wave(seconds) {
  const sampleRate = 8_000, dataSize = seconds * sampleRate * 2, buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < seconds * sampleRate; i++) buffer.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  return buffer;
}
test("real server probe measures synthetic audio and rejects long or undecodable files", async () => {
  const f = fixture(); const input = { ...f.input, fileName: "announcement.wav", claimedType: "audio/wav", buffer: wave(2) };
  const { measureDuration: _mock, ...options } = f.options;
  const stored = await uploadRetailCommercial(f.db, { ...options, input }); assert.equal(stored.uploads[0].durationSeconds, 2);
  const g = fixture(), { measureDuration: _otherMock, ...actualOptions } = g.options;
  await assert.rejects(uploadRetailCommercial(g.db, { ...actualOptions, input: { ...input, buffer: wave(301) } }), { code: "RETAIL_COMMERCIAL_UPLOAD_DURATION_INVALID" });
  await assert.rejects(uploadRetailCommercial(g.db, actualOptions), { code: "RETAIL_COMMERCIAL_UPLOAD_DURATION_INVALID" });
  assert.equal(g.d.puts.length, 0);
});
