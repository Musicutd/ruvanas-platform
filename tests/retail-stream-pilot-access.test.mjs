import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { retailStreamStationSlug } from "../lib/retail-stream-setup-service.mjs";
import { RETAIL_PILOT_ACCESS as P, loadRetailPilotAccess, loadRetailPilotAccessProposal, changeRetailPilotAccess } from "../lib/retail-stream-pilot-access.mjs";
import { loadRetailPlayoutReadiness, prepareRetailPlayout, startRetailPlayout, stopRetailPlayout,
  loadAuthorizedRetailPlayout } from "../lib/retail-stream-playout-service.mjs";

const NOW = new Date("2026-10-25T08:00:00Z"), EXPIRY = new Date("2026-11-23T12:00:00Z"), ADMIN = "platform-owner", USER = "retail-tester",
  STATION = "retail-pilot-station", WORKER = "srv-retail-only", clone = value => structuredClone(value);
const reason = code => ({ code: `RETAIL_PILOT_ACCESS_${code}` });
function fixture() {
  const subscription = { organisationId: P.organisationId, status: "TRIAL", currentPeriodEnd: EXPIRY, billingContract: null,
    complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false,
    ...previewTesterOverrides(["RETAIL"]), plan: { ...PREVIEW_TESTER_PLAN } };
  const organisation = { id: P.organisationId, name: "Private preview — Retail Test", enterpriseSecurityPolicy: null, subscription };
  const source = { stationId: STATION, providerKey: "CENTOVA_CAST", outputCodec: "MP3", serverHost: P.host, serverPort: P.port,
    sourcePort: P.port, centovaUsername: P.account, sourceUsername: null, streamUrl: P.listenerUrl, bitrateKbps: 128,
    sourcePasswordEncrypted: "synthetic-ciphertext", outboundAutoDjEnabled: false, probeEnabled: false,
    encoderLeaseOwner: null, encoderLeaseUntil: null, lastError: null, sourceConnectionStatus: "DISCONNECTED" };
  const station = { id: STATION, organisationId: P.organisationId, name: "Test Retail", slug: retailStreamStationSlug(P.organisationId),
    productFamily: "RETAIL", status: "DRAFT", publicPlayerEnabled: false, stationWebsiteEnabled: false, listenerRequestsEnabled: false,
    audiencePolicy: "INTERNAL", maxBitrateKbps: 128, organisation, streamConfig: source };
  const user = { id: USER, email: P.email, role: "OWNER", privatePreviewAccess: { userId: USER, organisationId: P.organisationId,
    enabled: true, passwordEnabled: true, pillars: ["RETAIL"], expiresAt: EXPIRY },
    memberships: [{ organisationId: P.organisationId, role: "OWNER", organisation }] };
  const tracks = ["one", "two"].map((name, index) => ({ id: `track-${name}`, title: name, artist: "Artist", status: "READY",
    catalogueProvider: "RUVANAS", rightsReviewStatus: "APPROVED", permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT",
    licenceExpiresAt: new Date("2027-01-01T00:00:00Z"), minimumCatalogueLevel: "FOCUSED", distributorItems: [],
    mediaAsset: { id: `asset-${name}`, organisationId: null, libraryType: "RUVANAS_CATALOGUE", licensedCatalogue: true,
      status: "READY", mediaType: "MUSIC", storageKey: `catalogue/music/${String(index + 1).repeat(64)}.mp3`, sizeBytes: 1000000n,
      checksumSha256: String(index + 1).repeat(64), durationSeconds: 180,
      genres: [{ mediaGenre: { name: "Pop", slug: "pop", active: true, minimumCatalogueLevel: "FOCUSED" } }] } }));
  const state = { station, user, admin: { id: ADMIN, role: "SUPER_ADMIN" }, memberCount: 1, tracks,
    genres: [{ name: "Pop", slug: "pop", active: true, minimumCatalogueLevel: "FOCUSED" }], audits: [], writes: [], locks: [] };
  function models(data) { return {
    $executeRaw: async (_strings, ...values) => { data.locks.push(values); return 1; },
    user: { findUnique: async args => clone(args.where.email === P.email ? data.user : args.where.id === data.admin.id ? data.admin : null) },
    organisationMember: { count: async () => data.memberCount },
    station: { findUnique: async args => clone(args.where.slug === data.station.slug ? data.station : null), findMany: async () => [clone(data.station)] },
    mediaGenre: { findMany: async () => clone(data.genres) }, track: { findMany: async () => clone(data.tracks) },
    studioBroadcastDestination: { findMany: async () => [] },
    auditLog: {
      findUnique: async args => clone(data.audits.find(row => row.id === args.where.id) || null),
      findMany: async args => clone(data.audits.filter(row => Object.entries(args.where).every(([key, value]) => row[key] === value))),
      upsert: async args => { data.writes.push({ kind: "audit-upsert", ...clone(args) }); const row = data.audits.find(row => row.id === args.where.id);
        if (row) Object.assign(row, clone(args.update)); else data.audits.push(clone(args.create)); },
      create: async args => { data.writes.push({ kind: "audit-history", ...clone(args) }); data.audits.push({ id: `history-${data.writes.length}`, ...clone(args.data) }); }
    }
  }; }
  const db = models(state); let tail = Promise.resolve();
  db.$transaction = operation => { const result = tail.then(async () => { const data = clone(state), value = await operation(models(data)); Object.assign(state, data); return value; }); tail = result.catch(() => {}); return result; };
  const env = { SECRET_ENCRYPTION_KEY: "11".repeat(32) }, options = { actorUserId: ADMIN, organisationId: P.organisationId, now: NOW, env };
  const inspectSource = async () => ({ ready: true, sourceDns: "PUBLIC", listenerDns: "PUBLIC", checkedAt: NOW.toISOString(), sourceCredential: "NOT_TESTED", audioTested: false });
  return { state, db, env, options,
    proposal: opts => loadRetailPilotAccessProposal(db, { ...options, ...opts }),
    approve: opts => changeRetailPilotAccess(db, { ...options, action: "approve", confirmed: true, ...opts }),
    revoke: opts => changeRetailPilotAccess(db, { ...options, action: "revoke", confirmed: true, ...opts }),
    access: opts => loadRetailPilotAccess(db, { station: state.station, now: NOW, env, ...opts }),
    readiness: opts => loadRetailPlayoutReadiness(db, { ...options, inspectSource, ...opts }),
    prepare: () => prepareRetailPlayout(db, { ...options, territory: "MT", genreCodes: ["POP"] }),
    start: () => startRetailPlayout(db, { ...options, inspectSource, monthlyBudgetUsd: 15.75, publicExposureAccepted: true }),
    stop: () => stopRetailPlayout(db, options),
    authorized: () => loadAuthorizedRetailPlayout(db, { ...options, workerId: WORKER }) };
}
function capacity(f) {
  f.env.RUVANAS_RETAIL_PLAYOUT_ENABLED = "true";
  f.env.RUVANAS_RETAIL_CAPACITY = JSON.stringify([{ organisationId: P.organisationId, stationId: STATION, workerId: WORKER,
    slot: "one", monthlyBudgetUsd: 15.75, monthlyComputeUsd: 7, monthlyOtherReserveUsd: 1, bandwidthUsdPerGB: .15, maxBitrateKbps: 128 }]);
}

test("read-only proposal shows existing Retail eligibility without granting access or changing plans", async () => {
  const f = fixture(), before = clone(f.state);
  assert.equal(await f.access(), null);
  const view = await f.proposal();
  assert.deepEqual(view, { eligible: true, approved: false, canApprove: true, canRevoke: false, territory: "MT", catalogueLevel: "FOCUSED",
    sourceScopes: ["RUVANAS_CORE", "LICENSED_CATALOGUE"], eligibleTrackCount: 2, expiresAt: EXPIRY.toISOString(), blocker: null });
  assert.deepEqual(f.state, before);
  assert.doesNotMatch(JSON.stringify(view), /synthetic-ciphertext|sourcePassword|storageKey|SECRET_ENCRYPTION_KEY/);
});
test("approval writes only a scoped signed audit grant and preserves all preview defaults and connection fields", async () => {
  const f = fixture(), before = clone(f.state.station);
  const result = await f.approve(); assert.equal(result.accepted, true); assert.equal(result.access.approved, true);
  assert.deepEqual(f.state.station, before); assert.equal(resolveEntitlements(f.state.station.organisation.subscription, NOW).outputEnabled, false);
  assert.equal(resolveEntitlements(f.state.station.organisation.subscription, NOW).licensedMusicCatalogueLevel, "NONE");
  assert.equal(f.state.writes.length, 2); assert.ok(f.state.writes.every(row => row.kind.startsWith("audit")));
  assert.equal(f.state.audits.some(row => row.action === "RETAIL_PLAYOUT_CONTROL"), false);
  assert.ok(f.state.locks.some(values => values[0] === "retail-shared-stream-setup:v1"));
  assert.equal((await f.access()).approved, true);
});
test("duplicate approval is idempotent and never renews access or increases its scope", async () => {
  const f = fixture(); await f.approve(); const before = clone(f.state.audits);
  await f.approve({ now: new Date(NOW.getTime() + 1000) }); assert.deepEqual(f.state.audits, before);
});
test("owner, exact organisation, source identity and explicit confirmation are mandatory", async () => {
  for (const patch of [{ actorUserId: USER }, { organisationId: "other-org" }, { confirmed: false }, { action: "start" }]) {
    const f = fixture(); await assert.rejects(f.approve(patch)); assert.equal(f.state.writes.length, 0);
  }
  for (const mutate of [s => { s.station.streamConfig.sourcePort = 8282; }, s => { s.station.streamConfig.serverHost = "elsewhere.example"; },
    s => { s.station.streamConfig.centovaUsername = "other"; }, s => { s.station.streamConfig.sourceUsername = "source"; },
    s => { s.station.productFamily = "ONLINE"; }, s => { s.station.publicPlayerEnabled = true; }]) {
    const f = fixture(); mutate(f.state); await assert.rejects(f.approve(), reason("TARGET_UNAVAILABLE")); assert.equal(f.state.writes.length, 0);
  }
});
test("pilot approval cannot broaden an expired, disabled, differently scoped or multi-member tester", async () => {
  for (const mutate of [s => { s.user.privatePreviewAccess.enabled = false; }, s => { s.user.privatePreviewAccess.expiresAt = new Date(NOW); },
    s => { s.user.privatePreviewAccess.pillars = ["RETAIL", "ONLINE"]; }, s => { s.memberCount = 2; },
    s => { s.user.memberships[0].organisation.subscription.plan.licensedMusicCatalogueLevel = "PREMIUM"; },
    s => { s.user.memberships[0].role = "MANAGER"; }]) {
    const f = fixture(); mutate(f.state); await assert.rejects(f.approve(), reason("TESTER_UNAVAILABLE")); assert.equal(f.state.writes.length, 0);
  }
});
test("approval is unavailable while a source lease or START request exists", async () => {
  for (const busy of ["lease", "start"]) {
    const f = fixture(); if (busy === "lease") f.state.station.streamConfig.encoderLeaseOwner = "existing-worker";
    else f.state.audits.push({ id: `retail-playout:control:${STATION}`, details: { command: { action: "START" } } });
    assert.equal((await f.proposal()).canApprove, false); await assert.rejects(f.approve(), reason("STOP_REQUIRED"));
  }
});
test("forged, changed, expired, wrong-owner and revoked grants fail closed", async () => {
  for (const mutate of [s => { s.audits[0].details.signature = "00".repeat(32); }, s => { s.audits[0].details.command.catalogueLevel = "PREMIUM"; },
    s => { s.station.streamConfig.sourcePasswordEncrypted = "changed-ciphertext"; }, s => { s.admin.role = "ADMIN"; },
    s => { s.user.privatePreviewAccess.enabled = false; }, s => { s.audits[0].organisationId = "other"; }]) {
    const f = fixture(); await f.approve(); mutate(f.state); assert.equal(await f.access(), null);
  }
  const f = fixture(); await f.approve(); assert.equal(await f.access({ now: new Date(EXPIRY) }), null);
  await f.revoke({ env: {} }); assert.equal(await f.access(), null);
});
test("source and playback changes cannot hide revocation or revive an old approval after restoration", async () => {
  for (const mutate of [s => { s.streamConfig.serverHost = "changed.example"; }, s => { s.streamConfig = null; },
    s => { s.status = "ACTIVE"; }, s => { s.publicPlayerEnabled = true; }, s => { s.streamConfig.outboundAutoDjEnabled = true; }]) {
    const f = fixture(); await f.approve(); const original = clone(f.state.station);
    mutate(f.state.station); assert.equal(await f.access(), null);
    const review = await f.proposal();
    assert.equal(review.eligible, false); assert.equal(review.approved, false); assert.equal(review.canApprove, false); assert.equal(review.canRevoke, true);
    await assert.rejects(f.approve(), reason("TARGET_UNAVAILABLE"));
    const revoked = await f.revoke({ env: {} }); assert.equal(revoked.access.approved, false); assert.equal(revoked.access.canRevoke, false);
    f.state.station = original;
    assert.equal(await f.access(), null); assert.equal((await f.proposal()).approved, false);
  }
});
test("revocation still refuses a foreign organisation or changed managed station identity", async () => {
  for (const mutate of [s => { s.organisationId = "foreign-org"; }, s => { s.productFamily = "ONLINE"; }, s => { s.slug = "unmanaged"; }]) {
    const f = fixture(); await f.approve(); const before = clone(f.state.audits); mutate(f.state.station);
    await assert.rejects(f.revoke(), reason("TARGET_UNAVAILABLE")); assert.deepEqual(f.state.audits, before);
  }
});
test("proposal and approved access keep product, territory, genre, rights and media checks", async () => {
  const f = fixture(); f.state.tracks[0].permittedUses = ["ONLINE_RADIO"];
  assert.equal((await f.proposal()).eligibleTrackCount, 1);
  f.state.tracks[1].permittedTerritories = "GB"; assert.equal((await f.proposal()).eligibleTrackCount, 0);
  await f.approve(); await f.prepare(); const view = await f.readiness(); assert.equal(view.eligibleTrackCount, 0);
  assert.ok(view.blockers.includes("RETAIL_PLAYOUT_NO_APPROVED_MUSIC"));
});
test("pilot access exposes eligible music only to the Retail engine; music and approval do not activate or allocate", async () => {
  const f = fixture(); await f.prepare(); assert.equal((await f.readiness()).eligibleTrackCount, 0);
  await f.approve(); const view = await f.readiness();
  assert.equal(view.eligibleTrackCount, 2); assert.equal(view.enabled, false); assert.equal(view.canStart, false);
  assert.ok(!view.blockers.includes("RETAIL_PLAYOUT_OUTPUT_NOT_PERMITTED"));
  assert.ok(view.blockers.includes("RETAIL_PLAYOUT_CAPACITY_NOT_ASSIGNED")); assert.ok(view.blockers.includes("RETAIL_PLAYOUT_LIVE_DISABLED"));
  assert.equal(f.state.station.streamConfig.encoderLeaseOwner, null);
  await assert.rejects(prepareRetailPlayout(f.db, { ...f.options, territory: "GB", genreCodes: [] }), { code: "RETAIL_PLAYOUT_TERRITORY_REQUIRED" });
});
test("worker authorization rechecks revocation, and reapproval cannot revive a previous START grant", async () => {
  const f = fixture(); capacity(f); await f.prepare(); await f.approve(); await f.start();
  const originalControl = clone(f.state.audits.find(row => row.id === `retail-playout:control:${STATION}`));
  assert.equal((await f.authorized()).tracks.length, 2);
  await f.revoke(); await assert.rejects(f.authorized(), { code: "RETAIL_PLAYOUT_OUTPUT_NOT_PERMITTED" });
  await f.stop(); await f.approve();
  Object.assign(f.state.audits.find(row => row.id === originalControl.id), originalControl);
  await assert.rejects(f.authorized(), { code: "RETAIL_PLAYOUT_PILOT_ACCESS_CHANGED" });
});
test("non-pilot organisations cannot inherit the approval and require no pilot database reads", async () => {
  const result = await loadRetailPilotAccess({}, { station: { organisationId: "another-org" }, now: NOW, env: {} }); assert.equal(result, null);
});
