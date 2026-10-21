import test from "node:test";
import assert from "node:assert/strict";
import { eligibleOnlineRadioRotation, eligibleScheduledOnlineRotation } from "../lib/online-radio-output.mjs";
import { licensedManualCatalogueDecision } from "../lib/online-radio-catalogue-policy.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN } from "../lib/private-preview-account-policy.mjs";

const NOW = new Date("2026-10-21T12:00:00.000Z"), EARLIER = new Date("2026-10-20T12:00:00.000Z");
const ORG = "cmaccountedorganisation01", OTHER = "cmforeignorganisation001";
const STATION = "cmaccountedstation00001", CHANNEL = "cmaccountedchannel00001", OWNER = "cmaccountedowner0000001";

function fixture() {
  const genre = { id: "cmaccountedgenre000001", slug: "pop", name: "Pop", active: true,
    providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED" };
  const track = { id: "cmaccountedtrack000001", mediaAssetId: "cmaccountedasset000001", title: "Pristine manual fixture", artist: "Fixture artist",
    status: "READY", catalogueProvider: null, distributorItems: [], minimumCatalogueLevel: "FOCUSED",
    rightsHolder: "Fixture master holder", rightsReference: "Fixture direct licence declaration", rightsBasis: "DIRECT_LICENCE",
    rightsReviewStatus: "APPROVED", rightsConfirmedAt: EARLIER, rightsReviewedAt: EARLIER,
    rightsConfirmedById: OWNER, rightsReviewedById: OWNER, permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"],
    licenceStartsAt: null, licenceExpiresAt: new Date("2026-12-31T00:00:00.000Z"), updatedAt: EARLIER,
    mediaAsset: { id: "cmaccountedasset000001", organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC",
      status: "READY", licensedCatalogue: true, storageKey: `catalogue/music/${"a".repeat(64)}.mp3`, sizeBytes: 1_000_000n,
      durationSeconds: 181, updatedAt: EARLIER, genres: [{ mediaGenre: genre }] } };
  const entry = { track, weight: 100, position: 1, genreCodes: ["POP"] };
  const mode = { id: "cmaccountedmode0000001", organisationId: ORG, status: "ACTIVE", tracks: [entry] };
  const policy = { organisationId: ORG, channelId: CHANNEL, enabled: true, state: "ACTIVE", playbackPolicy: "RUN_24_7",
    rightsUse: "ONLINE_RADIO", territory: "MT", sourceScopes: ["LICENSED_CATALOGUE"], selectedGenreCodes: ["POP"],
    defaultMusicModeId: mode.id, defaultMusicMode: mode, backupMusicMode: null, updatedAt: EARLIER };
  const station = { id: STATION, organisationId: ORG, productFamily: "ONLINE", status: "PENDING_SETUP", maxBitrateKbps: 128,
    streamConfig: { outboundAutoDjEnabled: true, providerKey: "CENTOVA_CAST", serverHost: "source.example.invalid", sourcePort: 8282,
      sourceUsername: null, sourcePasswordEncrypted: "synthetic-not-a-real-credential", bitrateKbps: 128 },
    channels: [{ id: CHANNEL, organisationId: ORG, stationId: STATION, musicRightsUse: "ONLINE_RADIO", status: "ACTIVE", autoDjPolicy: policy }] };
  const subscription = { status: "TRIAL", currentPeriodStart: EARLIER, currentPeriodEnd: new Date("2026-11-21T12:00:00.000Z"),
    plan: { id: "cmcommercialplan000001", code: "ONLINE_RADIO_TIER_3", name: "Synthetic ordinary commercial Online Radio",
      active: true, productFamily: "ONLINE", tierNumber: 3, onlineRadioEnabled: true, includesRuvanasCatalogue: true,
      licensedMusicCatalogueLevel: "FOCUSED", stationLimit: 1, listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128 } };
  const entitlements = resolveEntitlements(subscription, NOW);
  const event = { id: "cmaccountedevent000001", organisationId: ORG, channelId: CHANNEL, cancelledAt: null,
    startsAt: new Date(NOW.getTime() - 5 * 60_000), endsAt: new Date(NOW.getTime() + 60 * 60_000),
    smartPlaylist: { id: "cmaccountedplaylist001", organisationId: ORG, status: "ACTIVE", rightsUse: "ONLINE_RADIO", territory: "MT",
      simpleBuildMode: "RANDOM_GENRE_POOL", durationMinutes: 1, genreCodes: ["POP"], version: 1, musicModeId: mode.id, updatedAt: EARLIER } };
  return { instant: NOW, station, track, entry, mode, policy, subscription, entitlements, event, configuredGenres: [genre],
    deliveryOptions: { manualCatalogueOutput: true, deliveryAccounting: true } };
}

function continuous(f, flags = f.deliveryOptions) {
  return eligibleOnlineRadioRotation(f.station, f.entitlements, f.instant, f.configuredGenres, flags);
}
function scheduled(f, flags = f.deliveryOptions) {
  return eligibleScheduledOnlineRotation(f.station, f.entitlements, f.event, [f.entry], f.instant,
    { ...flags, configuredGenres: f.configuredGenres });
}
const flows = [["continuous", continuous], ["scheduled", scheduled]];

test("a pristine manual master with real resolved commercial entitlements passes only the accounted opt-in path", () => {
  const f = fixture(), before = structuredClone(f);
  assert.equal(f.entitlements.serviceEnabled, true);
  assert.equal(f.entitlements.outputEnabled, true);
  assert.equal(f.entitlements.sandboxDraftOnly, false);
  assert.equal(f.entitlements.licensedMusicCatalogueEnabled, true);
  assert.equal(licensedManualCatalogueDecision(f.track, { enabled: true, organisationId: ORG, entitlements: f.entitlements,
    territory: "MT", instant: NOW, stopAt: new Date(NOW.getTime() + 183_000), configuredGenres: f.configuredGenres }).allowed, true);
  for (const [name, run] of flows) {
    const result = run(f);
    assert.equal(result.ready, true, name);
    assert.ok(result.entries.length > 0, name);
    assert.ok(result.entries.every(entry => entry.track.id === f.track.id && entry.track.mediaAsset.licensedCatalogue === true), name);
  }
  assert.deepEqual(f, before);
});

for (const [name, run] of flows) {
  test(`${name}: missing or non-boolean delivery/accounting flags never admit licensed audio`, () => {
    const f = fixture();
    for (const flags of [{}, { manualCatalogueOutput: true }, { deliveryAccounting: true },
      { manualCatalogueOutput: false, deliveryAccounting: true }, { manualCatalogueOutput: true, deliveryAccounting: false },
      { manualCatalogueOutput: "true", deliveryAccounting: true }, { manualCatalogueOutput: true, deliveryAccounting: "true" }]) {
      assert.equal(run(f, flags).ready, false, JSON.stringify(flags));
    }
  });

  test(`${name}: LICENSED source scope and active Online Radio policy remain explicit`, () => {
    const mutations = [f => { f.policy.sourceScopes = ["RUVANAS_CORE"]; }, f => { f.policy.sourceScopes = []; },
      f => { f.policy.sourceScopes = undefined; }, f => { f.policy.enabled = false; }, f => { f.policy.state = "PAUSED"; },
      f => { f.policy.rightsUse = "RETAIL_RADIO"; }, f => { f.station.streamConfig.outboundAutoDjEnabled = false; }];
    for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal(run(f).ready, false); }
  });

  test(`${name}: preview, missing service, wrong country, tier, provider, expired or revoked rights fail closed`, () => {
    const mutations = [
      ["real preview plan", f => { f.subscription.plan = structuredClone(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN); f.entitlements = resolveEntitlements(f.subscription, NOW); }],
      ["contradictory preview plan", f => { f.entitlements = { ...f.entitlements, planCode: "PRIVATE_PREVIEW_ONLINE_DRAFT_CATALOGUE_MT_V1" }; }],
      ["output disabled", f => { f.entitlements = { ...f.entitlements, outputEnabled: false }; }],
      ["service inactive", f => { f.entitlements = { ...f.entitlements, serviceEnabled: false }; }],
      ["different country", f => { f.policy.territory = "US"; }],
      ["unknown country", f => { f.policy.territory = null; }],
      ["higher track tier", f => { f.track.minimumCatalogueLevel = "PREMIUM"; }],
      ["no catalogue tier", f => { f.entitlements = { ...f.entitlements, licensedMusicCatalogueLevel: "NONE", licensedMusicCatalogueEnabled: false }; }],
      ["provider origin", f => { f.track.catalogueProvider = "UNSUPPORTED_PROVIDER"; }],
      ["distributor relation", f => { f.track.distributorItems = [{ id: "synthetic-distributor-item", status: "ACTIVE", autoDjReady: true }]; }],
      ["unloaded distributor origin", f => { delete f.track.distributorItems; }],
      ["expired rights", f => { f.track.licenceExpiresAt = new Date("2026-10-20T00:00:00.000Z"); }],
      ["revoked review", f => { f.track.rightsReviewStatus = "REJECTED"; }],
      ["missing declaration", f => { f.track.rightsConfirmedAt = null; }],
      ["wrong pillar", f => { f.track.permittedUses = ["RETAIL_RADIO"]; }],
      ["foreign owned media", f => { f.track.mediaAsset.organisationId = OTHER; }],
      ["inactive genre", f => { f.track.mediaAsset.genres[0].mediaGenre.active = false; }],
    ];
    for (const [label, mutate] of mutations) { const f = fixture(); mutate(f); assert.equal(run(f).ready, false, label); }
  });

  test(`${name}: full recording duration plus transition cannot cross the canonical licence expiry`, () => {
    const f = fixture(); f.instant = new Date("2026-10-21T23:58:00.000Z");
    f.track.licenceExpiresAt = new Date("2026-10-21T00:00:00.000Z");
    f.event.startsAt = new Date(f.instant.getTime() - 60_000); f.event.endsAt = new Date(f.instant.getTime() + 60 * 60_000);
    assert.equal(run(f).ready, false);
    f.track.licenceExpiresAt = new Date("2026-10-22T00:00:00.000Z");
    assert.equal(run(f).ready, true);
  });
}

test("scheduled: custom Premium genres must be passed through the delivery options", () => {
  const f = fixture(), genre = f.track.mediaAsset.genres[0].mediaGenre;
  Object.assign(genre, { slug: "custom-approved", name: "Custom approved", minimumCatalogueLevel: "PREMIUM" });
  f.track.minimumCatalogueLevel = "PREMIUM"; f.entry.genreCodes = ["CUSTOM_APPROVED"];
  f.policy.selectedGenreCodes = ["CUSTOM_APPROVED"]; f.event.smartPlaylist.genreCodes = ["CUSTOM_APPROVED"];
  f.entitlements = { ...f.entitlements, licensedMusicCatalogueLevel: "PREMIUM", planCode: "ONLINE_RADIO_TIER_5" };
  assert.equal(scheduled(f).ready, true);
  assert.equal(eligibleScheduledOnlineRotation(f.station, f.entitlements, f.event, [f.entry], f.instant, f.deliveryOptions).ready, false);
});

test("continuous: foreign channel, policy and music-mode ownership cannot borrow a shared licensed master", () => {
  const mutations = [f => { f.station.channels[0].organisationId = OTHER; },
    f => { f.policy.organisationId = OTHER; }, f => { f.policy.channelId = "cmforeignchannel000001"; },
    f => { f.mode.organisationId = OTHER; }];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal(continuous(f).ready, false); }
});

test("scheduled: foreign event, playlist, channel and policy ownership cannot borrow a shared licensed master", () => {
  const mutations = [f => { f.event.organisationId = OTHER; }, f => { f.event.smartPlaylist.organisationId = OTHER; },
    f => { f.station.channels[0].organisationId = OTHER; }, f => { f.policy.organisationId = OTHER; },
    f => { f.policy.channelId = "cmforeignchannel000001"; }];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal(scheduled(f).ready, false); }
});

test("normal core and subscriber sources retain their existing path without licensed opt-in flags", () => {
  for (const [name, run] of flows) for (const source of ["RUVANAS_CORE", "SUBSCRIBER_LIBRARY"]) {
    const f = fixture(); f.track.mediaAsset.licensedCatalogue = false; f.policy.sourceScopes = [source];
    if (source === "SUBSCRIBER_LIBRARY") {
      Object.assign(f.track.mediaAsset, { libraryType: "ORGANISATION_MUSIC", organisationId: ORG,
        storageKey: `organisations/${ORG}/music/${"a".repeat(64)}.mp3` });
    }
    assert.equal(run(f, {}).ready, true, `${name}: ${source}`);
    assert.equal(f.track.mediaAsset.licensedCatalogue, false);
  }
});

test("accounted output cannot rescue a provider origin by relabelling it unlicensed core", () => {
  for (const [name, run] of flows) for (const [label, mutate] of [
    ["provider marker", f => { f.track.catalogueProvider = "UNSUPPORTED_PROVIDER"; }],
    ["distributor relation", f => { f.track.distributorItems = [{ id: "synthetic-linked-item", status: "ACTIVE", autoDjReady: true }]; }],
    ["distributor rights basis", f => { f.track.rightsBasis = "DISTRIBUTOR_LICENCE"; }],
  ]) {
    const f = fixture(); f.track.mediaAsset.licensedCatalogue = false; f.policy.sourceScopes = ["RUVANAS_CORE"]; mutate(f);
    assert.equal(run(f).ready, false, `${name}: ${label}`);
  }
});

test("accounted cache cannot report an empty rotation as ready and can fall back to a valid backup", () => {
  const f = fixture();
  f.track.mediaAsset.licensedCatalogue = false;
  f.policy.sourceScopes = ["RUVANAS_CORE"];
  f.track.mediaAsset.sizeBytes = 900n * 1024n * 1024n;
  assert.equal(continuous(f).ready, false);
  assert.equal(scheduled(f).ready, false);
  const backupTrack = structuredClone(f.track);
  backupTrack.id = "cmbackuptrack00000001";
  backupTrack.mediaAsset.id = "cmbackupasset00000001";
  backupTrack.mediaAsset.sizeBytes = 1_000_000n;
  const backup = { ...f.mode, id: "cmbackupmode000000001", tracks: [{ ...f.entry, track: backupTrack }] };
  f.policy.backupMusicMode = backup;
  const result = continuous(f);
  assert.equal(result.ready, true);
  assert.equal(result.mode.id, backup.id);
  assert.equal(result.entries.length, 1);
});
