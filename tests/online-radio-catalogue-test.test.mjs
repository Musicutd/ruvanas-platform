import test from "node:test";
import assert from "node:assert/strict";
import {
  TEST_RADIO_CATALOGUE_TEST as LIMITS,
  CATALOGUE_TEST_REASON_LABELS,
  validateCatalogueTestAuthorization,
  catalogueTestTrackDecision,
  catalogueTestTrackFingerprint,
  buildOnlineRadioCatalogueTestPlan,
  safeCatalogueTestPlan,
} from "../lib/online-radio-catalogue-test.mjs";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const EARLIER = new Date("2026-10-20T12:00:00.000Z");
const ORGANISATION_ID = "cmtestorganisation00001";
const OWNER_ID = "cmtestowner00000000001";
const genre = (slug = "pop", overrides = {}) => ({ id: `cmtestgenre${slug}00000001`, slug, name: slug,
  active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED", ...overrides });

function track(index, durationSeconds = 130) {
  const mediaAssetId = `cmtestasset${String(index).padStart(10, "0")}`;
  return {
    id: `cmtesttrack${String(index).padStart(10, "0")}`, mediaAssetId,
    title: `Recording ${index}`, artist: `Artist ${index}`, status: "READY", catalogueProvider: null,
    minimumCatalogueLevel: "FOCUSED", rightsHolder: "Recorded rights holder", rightsReference: "Reviewed manual catalogue licence",
    rightsBasis: "OTHER", rightsReviewStatus: "APPROVED", rightsReviewedAt: EARLIER, rightsReviewedById: OWNER_ID,
    rightsConfirmedAt: EARLIER, rightsConfirmedById: OWNER_ID,
    permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"],
    licenceStartsAt: null, licenceExpiresAt: new Date("2026-12-31T00:00:00.000Z"),
    updatedAt: EARLIER, distributorItems: [],
    mediaAsset: { id: mediaAssetId, organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC",
      status: "READY", licensedCatalogue: true, storageKey: `catalogue/music/${index.toString(16).padStart(64, "0")}.mp3`,
      sizeBytes: 1_000_000n, durationSeconds, mimeType: "audio/mpeg", updatedAt: EARLIER,
      genres: [{ mediaGenre: genre() }] },
  };
}

function fixture() {
  return {
    station: { id: LIMITS.stationId, organisationId: ORGANISATION_ID, productFamily: "ONLINE", status: "DRAFT",
      publicPlayerEnabled: false, stationWebsiteEnabled: false },
    // The test grant is separate authority. These normal preview restrictions
    // are intentionally unchanged throughout every successful test.
    entitlements: { serviceEnabled: true, onlineRadioEnabled: true, outputEnabled: false, sandboxDraftOnly: true,
      includesRuvanasCatalogue: false, licensedMusicCatalogueLevel: "NONE", planCode: "PRIVATE_PREVIEW_ONLINE_DRAFT_CATALOGUE_MT_V1" },
    authorization: { kind: "OWNER_CATALOGUE_TEST", actorRole: "SUPER_ADMIN", actorUserId: OWNER_ID,
      stationId: LIMITS.stationId, organisationId: ORGANISATION_ID, origin: LIMITS.origin, catalogueLevel: "FOCUSED",
      issuedAt: new Date(NOW.getTime() - 1000), expiresAt: new Date(NOW.getTime() + 599_000) },
    serviceExpiresAt: new Date("2026-11-18T12:00:00.000Z"), instant: NOW, origin: LIMITS.origin,
    seed: "server-selected-test-seed", durationSeconds: 300,
    configuredGenres: [genre()], tracks: [track(1), track(2), track(3)],
  };
}

function mutate(input, callback) {
  const copy = structuredClone(input);
  callback(copy);
  return copy;
}

function expectDenied(input, reason) {
  const plan = buildOnlineRadioCatalogueTestPlan(input);
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, reason);
  assert.equal(typeof plan.label, "string");
  assert.ok(plan.label.length > 0);
  return plan;
}

test("a separate owner grant builds a maximum five-minute plan without changing preview entitlements", () => {
  const input = fixture(), before = structuredClone(input);
  const plan = buildOnlineRadioCatalogueTestPlan(input);
  assert.equal(plan.ready, true);
  assert.equal(plan.mode, "OWNER_CATALOGUE_TEST");
  assert.equal(plan.stationId, LIMITS.stationId);
  assert.equal(plan.organisationId, ORGANISATION_ID);
  assert.equal(plan.territory, "MT");
  assert.equal(plan.catalogueLevel, "FOCUSED");
  assert.equal(plan.totalSeconds, 300);
  assert.equal(plan.targetSeconds, 300);
  assert.equal(plan.stopAt, "2026-10-21T12:05:00.000Z");
  assert.ok(plan.items.length >= 1 && plan.items.length <= 8);
  assert.ok(plan.items.every((item) => item.source === "LICENSED_CATALOGUE"));
  assert.equal(plan.items.reduce((sum, item) => sum + item.playDurationSeconds, 0), 300);
  assert.deepEqual(input, before);
  assert.equal(input.entitlements.outputEnabled, false);
  assert.equal(input.entitlements.licensedMusicCatalogueLevel, "NONE");
});

test("the last play is trimmed separately from verified original duration", () => {
  const plan = buildOnlineRadioCatalogueTestPlan(fixture());
  assert.equal(plan.ready, true);
  assert.equal(plan.items.at(-1).playDurationSeconds, 40);
  assert.equal(plan.items.at(-1).durationSeconds, 130);
  assert.equal(plan.items.at(-1).track.mediaAsset.durationSeconds, 130);
  let cursor = 0;
  for (const item of plan.items) {
    assert.equal(item.startOffsetSeconds, cursor);
    assert.ok(item.playDurationSeconds > 0 && item.playDurationSeconds <= item.durationSeconds);
    cursor += item.playDurationSeconds;
    assert.equal(item.endOffsetSeconds, cursor);
  }
  assert.equal(cursor, 300);
});

test("metadata permissions, normal output flags, or a client-like plan alone never replace owner authorization", () => {
  const input = fixture();
  for (const authorization of [null, undefined, {}, { ...input.entitlements }, { kind: "ONLINE_DRAFT_CATALOGUE" }]) {
    expectDenied({ ...input, authorization }, "OWNER_AUTHORIZATION_REQUIRED");
  }
  expectDenied({ ...input, entitlements: { ...input.entitlements, outputEnabled: true }, authorization: null }, "OWNER_AUTHORIZATION_REQUIRED");
});

test("authorization requires a Super Admin actor and is revoked fail-closed", () => {
  const input = fixture();
  for (const patch of [{ actorRole: "OWNER" }, { actorRole: "ADMIN" }, { actorUserId: "" }, { actorUserId: "bad\nidentity" },
    { revokedAt: NOW }, { revokedAt: "" }, { enabled: false }, { kind: "OWNER_CATALOGUE_TEST " }]) {
    expectDenied({ ...input, authorization: { ...input.authorization, ...patch } }, "OWNER_AUTHORIZATION_REQUIRED");
  }
});

test("authorization binds exact station, organisation, canonical origin, FOCUSED tier and maximum output scope", () => {
  const input = fixture();
  for (const patch of [{ stationId: "cmotherstation00000001" }, { organisationId: "cmotherorganisation001" },
    { origin: "https://ruvanas.com" }, { origin: "https://attacker.example" }, { catalogueLevel: "PREMIUM" },
    { catalogueLevel: "NONE" }, { territory: "US" }, { maximumSeconds: 301 }]) {
    expectDenied({ ...input, authorization: { ...input.authorization, ...patch } }, "AUTHORIZATION_SCOPE_INVALID");
  }
});

test("only this isolated Online Radio station in an allowed state can be planned", () => {
  const input = fixture();
  for (const patch of [{ id: "cmotherstation00000001" }, { organisationId: "" }, { productFamily: "RETAIL" },
    { productFamily: null }, { status: "PAUSED" }, { status: "SUSPENDED" }, { status: undefined }]) {
    expectDenied({ ...input, station: { ...input.station, ...patch } }, "TEST_STATION_REQUIRED");
  }
  for (const status of ["DRAFT", "PENDING_SETUP", "ACTIVE"]) {
    assert.equal(buildOnlineRadioCatalogueTestPlan({ ...input, station: { ...input.station, status } }).ready, true);
  }
});

test("Ruvanas public player and station website must remain explicitly disabled", () => {
  for (const name of ["publicPlayerEnabled", "stationWebsiteEnabled"]) {
    for (const value of [true, undefined, null, "false"]) {
      expectDenied(mutate(fixture(), (input) => { input.station[name] = value; }), "STATION_NOT_PRIVATE");
    }
  }
});

test("the test cannot restore inactive or missing Online Radio service", () => {
  for (const field of ["serviceEnabled", "onlineRadioEnabled"]) {
    for (const value of [false, undefined, null, "true"]) {
      expectDenied(mutate(fixture(), (input) => { input.entitlements[field] = value; }), "SERVICE_INACTIVE");
    }
  }
});

test("request origins are exact and never inferred from a caller URL or apex hostname", () => {
  for (const origin of [undefined, "https://ruvanas.com", "http://www.ruvanas.com", "https://www.ruvanas.com/", "https://www.ruvanas.com.attacker.example", "null"]) {
    expectDenied({ ...fixture(), origin }, "ORIGIN_NOT_ALLOWED");
  }
});

test("authorization windows are start-inclusive, expiry-exclusive and limited to ten preparation minutes", () => {
  const input = fixture();
  assert.equal(validateCatalogueTestAuthorization({ ...input, instant: input.authorization.issuedAt }).ready, true);
  for (const patch of [{ issuedAt: new Date(NOW.getTime() + 1) }, { expiresAt: NOW },
    { issuedAt: NOW, expiresAt: NOW }, { expiresAt: new Date(NOW.getTime() + 600_000) },
    { issuedAt: new Date(NaN) }, { expiresAt: "2026-10-21" }]) {
    expectDenied({ ...input, authorization: { ...input.authorization, ...patch } }, "AUTHORIZATION_EXPIRED");
  }
});

test("persisted exact UTC ISO grants work but ambiguous dates and non-finite instants fail", () => {
  const input = fixture();
  const persisted = { ...input, instant: NOW.toISOString(), serviceExpiresAt: input.serviceExpiresAt.toISOString(),
    authorization: { ...input.authorization, issuedAt: input.authorization.issuedAt.toISOString(), expiresAt: input.authorization.expiresAt.toISOString() } };
  assert.equal(buildOnlineRadioCatalogueTestPlan(persisted).ready, true);
  for (const instant of [new Date(NaN), NaN, Infinity, "10/21/2026", "2026-10-21T12:00:00Z", null]) {
    expectDenied({ ...input, instant }, "INVALID_TIME");
  }
});

test("private test service expiry is mandatory and cannot be expired or malformed", () => {
  for (const serviceExpiresAt of [null, undefined]) {
    expectDenied({ ...fixture(), serviceExpiresAt }, "SERVICE_EXPIRY_REQUIRED");
  }
  expectDenied({ ...fixture(), serviceExpiresAt: NOW }, "SERVICE_EXPIRED");
  expectDenied({ ...fixture(), serviceExpiresAt: new Date(NOW.getTime() - 1) }, "SERVICE_EXPIRED");
  expectDenied({ ...fixture(), serviceExpiresAt: "not a date" }, "SERVICE_EXPIRY_REQUIRED");
});

test("actual output clips to the earlier authorization or service deadline and never extends either", () => {
  const input = fixture();
  const grantClipped = buildOnlineRadioCatalogueTestPlan({ ...input,
    authorization: { ...input.authorization, expiresAt: new Date(NOW.getTime() + 42_900) } });
  assert.equal(grantClipped.targetSeconds, 42);
  assert.equal(grantClipped.stopAt, "2026-10-21T12:00:42.000Z");
  const serviceClipped = buildOnlineRadioCatalogueTestPlan({ ...input, serviceExpiresAt: new Date(NOW.getTime() + 17_500) });
  assert.equal(serviceClipped.targetSeconds, 17);
  assert.equal(serviceClipped.stopAt, "2026-10-21T12:00:17.000Z");
  expectDenied({ ...input, authorization: { ...input.authorization, expiresAt: new Date(NOW.getTime() + 999) } }, "AUTHORIZATION_EXPIRED");
});

test("duration, seed, candidate count, and configured genre inputs are bounded", () => {
  for (const durationSeconds of [0, -1, 300.001, NaN, Infinity, "300", null]) expectDenied({ ...fixture(), durationSeconds }, "INVALID_DURATION");
  for (const seed of ["", " ", "x".repeat(129), "x\ny", null, 2]) expectDenied({ ...fixture(), seed }, "INVALID_SEED");
  for (const tracks of [null, {}, Array(2001).fill(track(1))]) expectDenied({ ...fixture(), tracks }, "INVALID_TRACKS");
  for (const configuredGenres of [null, {}, Array(251).fill(genre())]) expectDenied({ ...fixture(), configuredGenres }, "INVALID_GENRES");
});

test("random ordering is deterministic across candidate input order and varies for new server seeds", () => {
  const input = fixture();
  input.tracks = Array.from({ length: 8 }, (_, index) => track(index + 1, 50));
  const order = (plan) => plan.items.map((item) => item.trackId);
  assert.deepEqual(order(buildOnlineRadioCatalogueTestPlan(input)), order(buildOnlineRadioCatalogueTestPlan({ ...input, tracks: [...input.tracks].reverse() })));
  const variants = new Set(Array.from({ length: 20 }, (_, index) => JSON.stringify(order(buildOnlineRadioCatalogueTestPlan({ ...input, seed: `server-seed-${index}` })))));
  assert.ok(variants.size > 1);
});

test("a multi-track random pool uses unique tracks and preserves independently reviewed sources", () => {
  const input = fixture();
  input.tracks = [track(1, 50), track(2, 50), track(3, 50)];
  input.durationSeconds = 150;
  input.tracks[1].mediaAsset.licensedCatalogue = false;
  const plan = buildOnlineRadioCatalogueTestPlan(input);
  assert.equal(plan.ready, true);
  assert.equal(plan.items.length, 3);
  for (let index = 1; index < plan.items.length; index += 1) assert.notEqual(plan.items[index - 1].trackId, plan.items[index].trackId);
  assert.ok(plan.items.some((item) => item.source === "RUVANAS_CORE"));
  assert.ok(plan.items.some((item) => item.source === "LICENSED_CATALOGUE"));
});

test("identical duplicate identities are deduplicated and conflicting duplicate records fail closed", () => {
  const input = fixture();
  const deduplicated = buildOnlineRadioCatalogueTestPlan({ ...input, durationSeconds: 100, tracks: [input.tracks[0], structuredClone(input.tracks[0])] });
  assert.equal(deduplicated.ready, true);
  assert.equal(deduplicated.eligibleTrackCount, 1);
  expectDenied({ ...input, tracks: [input.tracks[0], { ...input.tracks[0], permittedTerritories: "US" }] }, "DUPLICATE_TRACK_ID");
});

test("ready media and explicit approved declaration and review are required even for core releases", () => {
  const changes = [
    (item) => { item.status = "DRAFT"; }, (item) => { item.mediaAsset.status = "PROCESSING"; },
    (item) => { item.mediaAsset.mediaType = "PROMO"; }, (item) => { item.rightsReviewStatus = "IN_REVIEW"; },
    (item) => { item.rightsConfirmedAt = null; }, (item) => { item.rightsReviewedAt = null; },
    (item) => { item.rightsConfirmedById = null; }, (item) => { item.rightsReviewedById = null; },
    (item) => { item.rightsConfirmedAt = new Date(NOW.getTime() + 1); }, (item) => { item.rightsHolder = " "; },
    (item) => { item.rightsReference = ""; }, (item) => { item.rightsBasis = null; },
  ];
  for (const change of changes) {
    const input = fixture(); input.tracks = [track(1)]; input.tracks[0].mediaAsset.licensedCatalogue = false;
    change(input.tracks[0]);
    expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
  }
});

test("supplier-linked, Promo Only, unknown-provider, and unloaded distributor origins are never exceptions", () => {
  for (const patch of [{ catalogueProvider: "PROMO_ONLY" }, { catalogueProvider: "OTHER_PROVIDER" }, { catalogueProvider: "" },
    { rightsBasis: "DISTRIBUTOR_LICENCE" },
    { distributorItems: undefined }, { distributorItems: null }, { distributorItems: [{ id: "cmproviderrow00000001", status: "ACTIVE", autoDjReady: true }] }]) {
    const input = fixture(); input.tracks = [{ ...track(1), ...patch }];
    const plan = expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
    assert.equal(plan.excludedReasons.PROVIDER_OUTPUT_UNAVAILABLE, 1);
  }
});

test("private checksum-addressed catalogue identity, matching media ID, positive size and duration are mandatory", () => {
  const modifications = [
    (item) => { item.mediaAssetId = "cmwrongasset000000001"; },
    (item) => { item.mediaAsset.organisationId = ORGANISATION_ID; },
    (item) => { item.mediaAsset.libraryType = "ORGANISATION_MUSIC"; },
    (item) => { item.mediaAsset.storageKey = "https://attacker.example/song.mp3"; },
    (item) => { item.mediaAsset.storageKey = "catalogue/music/../song.mp3"; },
    (item) => { item.mediaAsset.storageKey = `catalogue/music/${"a".repeat(64)}.m3u`; },
    (item) => { item.mediaAsset.licensedCatalogue = undefined; },
    (item) => { item.mediaAsset.sizeBytes = 0n; }, (item) => { item.mediaAsset.sizeBytes = 50 * 1024 * 1024 + 1; },
    (item) => { item.mediaAsset.sizeBytes = "10.2"; }, (item) => { item.mediaAsset.durationSeconds = 0; },
    (item) => { item.mediaAsset.durationSeconds = 2; }, (item) => { item.mediaAsset.durationSeconds = 86_401; },
    (item) => { item.mediaAsset.durationSeconds = Infinity; }, (item) => { item.mediaAsset.durationSeconds = "130"; },
  ];
  for (const modification of modifications) {
    const input = fixture(); input.tracks = [track(1)]; modification(input.tracks[0]);
    expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
  }
  const input = fixture(); input.tracks = [null];
  expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
});

test("only explicit FOCUSED tier and active approved FOCUSED genres are eligible", () => {
  for (const minimumCatalogueLevel of ["PROFESSIONAL", "PREMIUM", "NONE", null, "FOCUSED "]) {
    const input = fixture(); input.tracks = [{ ...track(1), minimumCatalogueLevel }];
    const plan = expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
    assert.equal(plan.excludedReasons.CATALOGUE_TIER_REQUIRED, 1);
  }
  for (const genres of [[], [null], [{ mediaGenre: genre("pop", { active: false }) }],
    [{ mediaGenre: genre("pop", { providerReviewStatus: "PENDING" }) }], [{ mediaGenre: genre("country") }],
    [{ mediaGenre: genre("unknown") }]]) {
    const input = fixture(); input.tracks = [track(1)]; input.tracks[0].mediaAsset.genres = genres;
    const plan = expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
    assert.equal(plan.excludedReasons.CATALOGUE_GENRE_LOCKED, 1);
  }
});

test("the existing territory and Online Radio product checks are not widened by the test grant", () => {
  for (const patch of [{ permittedTerritories: "US" }, { permittedTerritories: "DE" }, { permittedTerritories: null },
    { permittedTerritories: "not a country" }, { permittedUses: [] }, { permittedUses: ["RETAIL_RADIO"] }]) {
    const input = fixture(); input.tracks = [{ ...track(1), ...patch }];
    expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
  }
});

test("licences must remain current through the complete bounded output, with UTC expiry-day semantics", () => {
  const input = fixture(); input.tracks = [track(1)];
  for (const patch of [{ licenceStartsAt: new Date("2026-10-22T00:00:00.000Z") },
    { licenceExpiresAt: new Date("2026-10-20T00:00:00.000Z") }, { licenceStartsAt: "bad date" }, { licenceExpiresAt: new Date(NaN) }]) {
    expectDenied({ ...input, tracks: [{ ...input.tracks[0], ...patch }] }, "NO_RIGHTS_APPROVED_AUDIO");
  }
  input.instant = new Date("2026-10-21T23:58:00.000Z");
  input.authorization.issuedAt = input.instant;
  input.authorization.expiresAt = new Date(input.instant.getTime() + 600_000);
  input.tracks[0].licenceExpiresAt = new Date("2026-10-21T00:00:00.000Z");
  expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
  const untilMidnight = buildOnlineRadioCatalogueTestPlan({ ...input, durationSeconds: 120 });
  assert.equal(untilMidnight.ready, true);
  assert.equal(untilMidnight.stopAt, "2026-10-22T00:00:00.000Z");
});

test("invalid recordings are excluded without replacing or changing their rights", () => {
  const input = fixture();
  input.durationSeconds = 100;
  input.tracks[0].permittedTerritories = "US";
  input.tracks[1].catalogueProvider = "PROMO_ONLY";
  const plan = buildOnlineRadioCatalogueTestPlan(input);
  assert.equal(plan.ready, true);
  assert.equal(plan.eligibleTrackCount, 1);
  assert.ok(plan.items.every((item) => item.trackId === input.tracks[2].id));
  assert.equal(Object.values(plan.excludedReasons).reduce((sum, count) => sum + count, 0), 2);
  assert.equal(input.tracks[0].permittedTerritories, "US");
  assert.equal(input.tracks[1].catalogueProvider, "PROMO_ONLY");
});

test("selected source files stay within 100 MiB and no more than eight plan items", () => {
  const input = fixture();
  input.tracks = [track(1, 100), track(2, 100), track(3, 100)];
  for (const item of input.tracks) item.mediaAsset.sizeBytes = 50 * 1024 * 1024;
  expectDenied(input, "PLAN_TOO_LARGE");
  input.tracks = [track(1, 180), track(2, 180)];
  for (const item of input.tracks) item.mediaAsset.sizeBytes = 50 * 1024 * 1024;
  const exact = buildOnlineRadioCatalogueTestPlan(input);
  assert.equal(exact.ready, true);
  assert.equal(exact.uniqueFileBytes, 100 * 1024 * 1024);
  input.tracks = [track(1, 3)];
  expectDenied(input, "INSUFFICIENT_AUDIO");
});

test("insufficient unique music cannot be rescued by repeating an approved recording", () => {
  const input = fixture(); input.tracks = [track(1, 130)];
  expectDenied(input, "INSUFFICIENT_AUDIO");
  const shorter = buildOnlineRadioCatalogueTestPlan({ ...input, durationSeconds: 130 });
  assert.equal(shorter.ready, true);
  assert.equal(shorter.items.length, 1);
  const full = buildOnlineRadioCatalogueTestPlan(fixture());
  assert.equal(new Set(full.items.map(({ trackId }) => trackId)).size, full.items.length);
});

test("track fingerprints are deterministic and change for every relevant media or rights input", () => {
  const original = track(1), initial = catalogueTestTrackFingerprint(original);
  assert.match(initial, /^[a-f0-9]{64}$/);
  assert.equal(catalogueTestTrackFingerprint(structuredClone(original)), initial);
  for (const modification of [
    (item) => { item.status = "DRAFT"; }, (item) => { item.rightsReference += " updated"; },
    (item) => { item.rightsReviewStatus = "REJECTED"; }, (item) => { item.rightsReviewedById = "cmotherowner000000001"; },
    (item) => { item.rightsConfirmedAt = NOW; }, (item) => { item.permittedUses = ["RETAIL_RADIO"]; },
    (item) => { item.permittedTerritories = "US"; }, (item) => { item.licenceExpiresAt = NOW; },
    (item) => { item.catalogueProvider = "PROMO_ONLY"; }, (item) => { item.distributorItems = [{ id: "cmrow0000000000001" }]; },
    (item) => { item.minimumCatalogueLevel = "PREMIUM"; }, (item) => { item.mediaAsset.storageKey += "x"; },
    (item) => { item.mediaAsset.sizeBytes += 1n; }, (item) => { item.mediaAsset.durationSeconds += 1; },
    (item) => { item.mediaAsset.status = "ARCHIVED"; }, (item) => { item.mediaAsset.licensedCatalogue = false; },
    (item) => { item.mediaAsset.genres[0].mediaGenre.active = false; }, (item) => { item.mediaAsset.updatedAt = NOW; },
  ]) {
    const changed = structuredClone(original); modification(changed);
    assert.notEqual(catalogueTestTrackFingerprint(changed), initial);
  }
});

test("a persisted selected track is rechecked against the original absolute deadline without rebuilding choices", () => {
  const input = fixture(), plan = buildOnlineRadioCatalogueTestPlan(input);
  const fixed = plan.items[0];
  const context = { organisationId: ORGANISATION_ID, instant: new Date(NOW.getTime() + 120_000),
    stopAt: plan.stopAt, configuredGenres: input.configuredGenres };
  const current = structuredClone(input.tracks.find((item) => item.id === fixed.trackId));
  assert.equal(catalogueTestTrackDecision(current, context), null);
  assert.equal(catalogueTestTrackFingerprint(current), fixed.fingerprint);
  current.rightsReviewStatus = "REJECTED";
  assert.equal(catalogueTestTrackDecision(current, context), "RIGHTS_DECLARATION_REQUIRED");
  assert.notEqual(catalogueTestTrackFingerprint(current), fixed.fingerprint);
  assert.equal(plan.items[0].trackId, fixed.trackId);
});

test("direct selected-track validation refuses invalid, expired, widened or missing revalidation context", () => {
  const input = fixture(), current = input.tracks[0];
  const context = { organisationId: ORGANISATION_ID, instant: NOW,
    stopAt: new Date(NOW.getTime() + 300_000), configuredGenres: input.configuredGenres };
  for (const patch of [{ organisationId: "" }, { instant: null }, { instant: new Date(NaN) },
    { stopAt: NOW }, { stopAt: new Date(NOW.getTime() - 1) }, { stopAt: new Date(NOW.getTime() + 300_001) },
    { stopAt: "2026-10-21" }]) {
    assert.equal(catalogueTestTrackDecision(current, { ...context, ...patch }), "RIGHTS_WINDOW_INACTIVE");
  }
  assert.equal(catalogueTestTrackDecision(current), "RIGHTS_WINDOW_INACTIVE");
  assert.equal(catalogueTestTrackDecision(current, { ...context, configuredGenres: null }), "CATALOGUE_GENRE_LOCKED");
});

test("unchanged fingerprint alone never substitutes for current rights or deadline checks", () => {
  const current = track(1), fingerprint = catalogueTestTrackFingerprint(current);
  current.licenceExpiresAt = new Date("2026-10-21T00:00:00.000Z");
  const pinned = catalogueTestTrackFingerprint(current);
  assert.notEqual(pinned, fingerprint);
  const context = { organisationId: ORGANISATION_ID, configuredGenres: [genre()],
    instant: new Date("2026-10-21T23:59:59.000Z"), stopAt: new Date("2026-10-22T00:00:01.000Z") };
  assert.equal(catalogueTestTrackFingerprint(current), pinned);
  assert.equal(catalogueTestTrackDecision(current, context), "RIGHTS_WINDOW_INACTIVE");
});

test("owner session identity is pinned separately and cannot be replaced with an invalid session field", () => {
  const input = fixture();
  input.authorization.actorSessionId = "cmownersession00000001";
  const first = buildOnlineRadioCatalogueTestPlan(input);
  const replaced = buildOnlineRadioCatalogueTestPlan(mutate(input, (item) => { item.authorization.actorSessionId = "cmothersession00000001"; }));
  assert.equal(first.ready, true);
  assert.notEqual(first.validation.authorizationFingerprint, replaced.validation.authorizationFingerprint);
  expectDenied(mutate(input, (item) => { item.authorization.actorSessionId = ""; }), "AUTHORIZATION_SCOPE_INVALID");
});

test("plan input fingerprints cover station, owner grant, service and genre settings for revalidation", () => {
  const input = fixture(), plan = buildOnlineRadioCatalogueTestPlan(input);
  for (const value of Object.values(plan.validation).filter((value) => typeof value === "string")) assert.match(value, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.validation.tracks.map(({ trackId }) => trackId).sort(), [...new Set(plan.items.map(({ trackId }) => trackId))].sort());
  for (const { trackId, fingerprint } of plan.validation.tracks) assert.equal(fingerprint, catalogueTestTrackFingerprint(input.tracks.find((item) => item.id === trackId)));
  const changedActor = buildOnlineRadioCatalogueTestPlan(mutate(input, (item) => { item.authorization.actorUserId = "cmotherowner000000001"; }));
  assert.notEqual(changedActor.validation.authorizationFingerprint, plan.validation.authorizationFingerprint);
  const changedService = buildOnlineRadioCatalogueTestPlan(mutate(input, (item) => { item.serviceExpiresAt = new Date("2026-11-19T12:00:00.000Z"); }));
  assert.notEqual(changedService.validation.entitlementsFingerprint, plan.validation.entitlementsFingerprint);
  const changedGenre = buildOnlineRadioCatalogueTestPlan(mutate(input, (item) => { item.configuredGenres[0].name = "Pop renamed"; }));
  assert.notEqual(changedGenre.validation.configuredGenresFingerprint, plan.validation.configuredGenresFingerprint);
});

test("the owner DTO includes useful plan metadata but no private media keys, IDs, URLs, authorization or fingerprints", () => {
  const input = fixture();
  input.tracks[0].mediaAsset.sourceUrl = "https://private-source.example/SECRET";
  input.authorization.privateMarker = "SECRET";
  const safe = safeCatalogueTestPlan(buildOnlineRadioCatalogueTestPlan(input));
  assert.equal(safe.ready, true);
  assert.equal(safe.items.reduce((sum, item) => sum + item.playDurationSeconds, 0), 300);
  const serialized = JSON.stringify(safe);
  for (const forbidden of ["catalogue/music/", "mediaAsset", "storageKey", "sourceUrl", "fingerprint", "authorization", "actorUserId", "SECRET", "server-selected-test-seed", ORGANISATION_ID]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  for (const item of input.tracks) assert.equal(serialized.includes(item.mediaAsset.id), false);
  assert.equal(JSON.stringify(safeCatalogueTestPlan(expectDenied({ ...input, authorization: null }, "OWNER_AUTHORIZATION_REQUIRED"))).includes("SECRET"), false);
});

test("all public refusal reasons have fixed non-sensitive labels", () => {
  for (const [reason, label] of Object.entries(CATALOGUE_TEST_REASON_LABELS)) {
    assert.match(reason, /^[A-Z_]+$/);
    assert.equal(typeof label, "string");
    assert.ok(label.length > 10 && label.length < 200);
  }
  assert.equal(Object.isFrozen(LIMITS), true);
  assert.equal(Object.isFrozen(CATALOGUE_TEST_REASON_LABELS), true);
});

function hourFixture() {
  const input = fixture();
  Object.assign(input.authorization, { profileId: "ONE_HOUR", maximumSeconds: 3600,
    issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 4_200_000) });
  input.durationSeconds = 3600;
  input.tracks = Array.from({ length: 20 }, (_, index) => track(index + 1, 180));
  return input;
}

test("an explicit one-hour grant builds exactly one hour of unique approved music without widening ordinary output", () => {
  const input = hourFixture(), before = structuredClone(input);
  const plan = buildOnlineRadioCatalogueTestPlan(input);
  assert.equal(plan.ready, true);
  assert.equal(plan.profileId, "ONE_HOUR");
  assert.equal(plan.totalSeconds, 3600);
  assert.equal(plan.stopAt, "2026-10-21T13:00:00.000Z");
  assert.equal(plan.items.length, 20);
  assert.equal(new Set(plan.items.map(item => item.trackId)).size, 20);
  assert.equal(plan.uniqueFileBytes, 20_000_000);
  assert.deepEqual(input, before);
  const dto = safeCatalogueTestPlan(plan);
  assert.equal(dto.profileId, "ONE_HOUR");
  assert.equal(dto.uniqueFileBytes, 20_000_000);
  assert.equal(input.entitlements.outputEnabled, false);
  assert.equal(buildOnlineRadioCatalogueTestPlan({ ...input, durationSeconds: undefined }).targetSeconds, 3600);
});

test("hour duration cannot be requested by a legacy or mismatched grant, nor altered to a caller-selected length", () => {
  const input = hourFixture();
  for (const authorization of [{ ...fixture().authorization, maximumSeconds: 3600 },
    { ...input.authorization, profileId: null }, { ...input.authorization, maximumSeconds: 300 }, { ...input.authorization, profileId: "UNKNOWN" }]) {
    expectDenied({ ...input, authorization }, "AUTHORIZATION_SCOPE_INVALID");
  }
  expectDenied({ ...fixture(), durationSeconds: 3600 }, "INVALID_DURATION");
  for (const durationSeconds of [300, 3599, 3601, "3600"]) expectDenied({ ...input, durationSeconds }, "INVALID_DURATION");
  expectDenied(mutate(input, item => { item.authorization.expiresAt = new Date(NOW.getTime() + 4_200_001); }), "AUTHORIZATION_EXPIRED");
  expectDenied(mutate(input, item => { item.authorization.expiresAt = new Date(NOW.getTime() + 3_599_999); }), "AUTHORIZATION_EXPIRED");
  expectDenied({ ...input, serviceExpiresAt: new Date(NOW.getTime() + 3_599_999) }, "AUTHORIZATION_EXPIRED");
});

test("hour planning preserves exact station, private exposure, rights and provider restrictions", () => {
  expectDenied(mutate(hourFixture(), input => { input.station.id = "cmanotherstation000001"; }), "TEST_STATION_REQUIRED");
  expectDenied(mutate(hourFixture(), input => { input.station.publicPlayerEnabled = true; }), "STATION_NOT_PRIVATE");
  for (const change of [item => { item.rightsReviewStatus = "PENDING"; }, item => { item.permittedTerritories = "US"; },
    item => { item.permittedUses = ["RETAIL"]; }, item => { item.catalogueProvider = "PROMO_ONLY"; },
    item => { item.minimumCatalogueLevel = "PREMIUM"; }]) {
    const input = hourFixture(); input.tracks.forEach(change);
    expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
  }
});

test("hour rights must cover the entire end window, not merely the first five minutes", () => {
  const input = hourFixture(), now = new Date("2026-10-21T23:30:00.000Z");
  input.instant = now; input.authorization.issuedAt = now;
  input.authorization.expiresAt = new Date(now.getTime() + 4_200_000);
  input.tracks.forEach(item => { item.licenceExpiresAt = new Date("2026-10-21T00:00:00.000Z"); });
  const denial = expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
  assert.equal(denial.excludedReasons.RIGHTS_WINDOW_INACTIVE, 20);
});

test("hour source-byte, unique-item and no-repeat limits remain finite and per-file size is unchanged", () => {
  const oversized = hourFixture(); oversized.tracks.forEach(item => { item.mediaAsset.sizeBytes = 14n * 1024n ** 2n; });
  expectDenied(oversized, "PLAN_TOO_LARGE");
  const tooMany = hourFixture(); tooMany.tracks = Array.from({ length: 41 }, (_, index) => track(index + 1, 89));
  expectDenied(tooMany, "INSUFFICIENT_AUDIO");
  expectDenied({ ...hourFixture(), tracks: [track(1, 180)] }, "INSUFFICIENT_AUDIO");
  const tooLargeFile = hourFixture(); tooLargeFile.tracks.forEach(item => { item.mediaAsset.sizeBytes = 50n * 1024n ** 2n + 1n; });
  expectDenied(tooLargeFile, "NO_RIGHTS_APPROVED_AUDIO");
  const standard = buildOnlineRadioCatalogueTestPlan(fixture());
  assert.equal(standard.profileId, "FIVE_MINUTES"); assert.equal(standard.targetSeconds, 300);
});

function handoverFixture() {
  const input = fixture();
  Object.assign(input.authorization, { profileId: "FIVE_MINUTES", maximumSeconds: 300, testMode: "HANDOVER_90_SECONDS" });
  return input;
}

test("handover scenario selects exactly three approved 30-second excerpts under unchanged five-minute authority", () => {
  const input = handoverFixture(), before = structuredClone(input), plan = buildOnlineRadioCatalogueTestPlan(input);
  assert.equal(plan.ready, true);
  assert.equal(plan.testMode, "HANDOVER_90_SECONDS");
  assert.equal(plan.targetSeconds, 300); assert.equal(plan.totalSeconds, 90); assert.equal(plan.audioDurationSeconds, 90);
  assert.equal(plan.stopAt, "2026-10-21T12:05:00.000Z");
  assert.deepEqual(plan.items.map(item => item.playDurationSeconds), [30, 30, 30]);
  assert.deepEqual(plan.items.map(item => item.startOffsetSeconds), [0, 30, 60]);
  assert.equal(new Set(plan.items.map(item => item.trackId)).size, 3);
  assert.deepEqual(input, before);
  const dto = safeCatalogueTestPlan(plan);
  assert.equal(dto.testMode, "HANDOVER_90_SECONDS"); assert.equal(dto.audioDurationSeconds, 90);
});

test("handover requires its exact named profile and cannot widen or shorten the permission window", () => {
  for (const input of [mutate(hourFixture(), value => { value.authorization.testMode = "HANDOVER_90_SECONDS"; }),
    mutate(handoverFixture(), value => { delete value.authorization.profileId; }),
    mutate(handoverFixture(), value => { delete value.authorization.maximumSeconds; }),
    mutate(handoverFixture(), value => { value.authorization.testMode = "unknown"; })]) expectDenied(input, "AUTHORIZATION_SCOPE_INVALID");
  for (const durationSeconds of [90, 299, 301]) expectDenied({ ...handoverFixture(), durationSeconds }, "INVALID_DURATION");
  expectDenied({ ...handoverFixture(), serviceExpiresAt: new Date(NOW.getTime() + 299_999) }, "AUTHORIZATION_EXPIRED");
  assert.equal(buildOnlineRadioCatalogueTestPlan(fixture()).totalSeconds, 300);
  assert.equal(buildOnlineRadioCatalogueTestPlan(hourFixture()).totalSeconds, 3600);
});

test("handover refuses too few distinct usable recordings and preserves normal rights/provider/file constraints", () => {
  expectDenied({ ...handoverFixture(), tracks: [track(1), track(2)] }, "HANDOVER_AUDIO_REQUIRED");
  expectDenied({ ...handoverFixture(), tracks: [track(1), track(2), track(3, 29)] }, "HANDOVER_AUDIO_REQUIRED");
  const duplicateAsset = handoverFixture(); duplicateAsset.tracks[2].mediaAssetId = duplicateAsset.tracks[1].mediaAssetId;
  duplicateAsset.tracks[2].mediaAsset = structuredClone(duplicateAsset.tracks[1].mediaAsset);
  expectDenied(duplicateAsset, "HANDOVER_AUDIO_REQUIRED");
  for (const change of [value => { value.rightsReviewStatus = "PENDING"; }, value => { value.permittedTerritories = "US"; },
    value => { value.permittedUses = ["RETAIL"]; }, value => { value.catalogueProvider = "PROMO_ONLY"; }]) {
    const input = handoverFixture(); input.tracks.forEach(change); expectDenied(input, "NO_RIGHTS_APPROVED_AUDIO");
  }
  const large = handoverFixture(); large.tracks.forEach(value => { value.mediaAsset.sizeBytes = 40n * 1024n ** 2n; });
  expectDenied(large, "PLAN_TOO_LARGE");
});
