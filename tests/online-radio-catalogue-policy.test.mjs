import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { licensedManualCatalogueDecision, filterLicensedManualCatalogueEntries } from "../lib/online-radio-catalogue-policy.mjs";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN } from "../lib/private-preview-account-policy.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const EARLIER = new Date("2026-10-20T12:00:00.000Z");
const ORG = "cmtestorganisation00001", OWNER = "cmtestowner00000000001";
const genre = (slug = "pop", extra = {}) => ({ id: "cmtestgenre000000001", slug, name: slug,
  active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED", ...extra });
function track() {
  return { id: "cmtesttrack00000000001", mediaAssetId: "cmtestasset00000000001", title: "Reviewed recording", artist: "Test artist",
    status: "READY", catalogueProvider: null, distributorItems: [], minimumCatalogueLevel: "FOCUSED",
    rightsHolder: "Recorded holder", rightsReference: "Reviewed direct licence", rightsBasis: "DIRECT_LICENCE",
    rightsReviewStatus: "APPROVED", rightsConfirmedAt: EARLIER, rightsReviewedAt: EARLIER,
    rightsConfirmedById: OWNER, rightsReviewedById: OWNER, permittedTerritories: "EUROPE", permittedUses: ["ONLINE_RADIO"],
    licenceStartsAt: null, licenceExpiresAt: new Date("2026-12-31T00:00:00.000Z"),
    mediaAsset: { id: "cmtestasset00000000001", organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC",
      status: "READY", licensedCatalogue: true, storageKey: `catalogue/music/${"a".repeat(64)}.mp3`,
      sizeBytes: 1_000_000n, durationSeconds: 181, genres: [{ mediaGenre: genre() }] } };
}
function options(extra = {}) {
  return { enabled: true, organisationId: ORG, territory: "MT", instant: NOW, stopAt: new Date(NOW.getTime() + 90 * 60_000),
    entitlements: { serviceEnabled: true, onlineRadioEnabled: true, outputEnabled: true, sandboxDraftOnly: false,
      planCode: "ONLINE_RADIO_TIER_3", licensedMusicCatalogueEnabled: true, licensedMusicCatalogueLevel: "FOCUSED" },
    configuredGenres: [genre()], ...extra };
}
const outcome = (record = track(), context = options()) => licensedManualCatalogueDecision(record, context);
function denyMutation(callback, reason, context = options()) {
  const record = track(); callback(record);
  assert.deepEqual(outcome(record, context), { allowed: false, reason });
}

test("manual licensed catalogue is an explicit, pure opt-in and leaves all inputs unchanged", () => {
  const record = track(), context = options(), before = structuredClone({ record, context });
  assert.deepEqual(outcome(record, context), { allowed: true, reason: "LICENSED_MANUAL_CATALOGUE" });
  assert.equal(Object.isFrozen(outcome(record, context)), true);
  assert.deepEqual({ record, context }, before);
  for (const enabled of [undefined, false, null, "true", 1]) {
    assert.equal(outcome(record, { ...context, enabled }).reason, "MANUAL_CATALOGUE_DISABLED");
  }
  assert.equal(licensedManualCatalogueDecision(record).allowed, false);
  for (const invalid of [null, false, "enabled", []]) assert.equal(licensedManualCatalogueDecision(record, invalid).allowed, false);
});

test("real output, active ONLINE service and actual licensed catalogue entitlements are mandatory", () => {
  for (const changes of [{ outputEnabled: false }, { outputEnabled: undefined }, { outputEnabled: "true" },
    { sandboxDraftOnly: true }, { planCode: "PRIVATE_PREVIEW_ONLINE_DRAFT_CATALOGUE_MT_V1" },
    { planCode: " private_preview_read_only " }]) {
    const context = options(); Object.assign(context.entitlements, changes);
    assert.equal(outcome(track(), context).reason, "OUTPUT_NOT_PERMITTED");
  }
  for (const changes of [{ serviceEnabled: false }, { serviceEnabled: undefined }, { onlineRadioEnabled: false }, { onlineRadioEnabled: "true" }]) {
    const context = options(); Object.assign(context.entitlements, changes);
    assert.equal(outcome(track(), context).reason, "SERVICE_INACTIVE");
  }
  for (const changes of [{ licensedMusicCatalogueEnabled: false }, { licensedMusicCatalogueEnabled: "true" },
    { licensedMusicCatalogueLevel: "NONE" }, { licensedMusicCatalogueLevel: "FOCUSED_PLUS" }]) {
    const context = options(); Object.assign(context.entitlements, changes);
    assert.equal(outcome(track(), context).reason, "CATALOGUE_PLAN_REQUIRED");
  }
  assert.equal(outcome(track(), options({ entitlements: null })).reason, "OUTPUT_NOT_PERMITTED");
});

test("the actual Radio metadata-only plan cannot be used as broadcast authority", () => {
  const entitlements = resolveEntitlements({ status: "TRIAL", currentPeriodEnd: new Date("2026-11-21T12:00:00.000Z"),
    plan: structuredClone(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN) }, NOW);
  assert.equal(entitlements.outputEnabled, false);
  assert.equal(entitlements.licensedMusicCatalogueLevel, "NONE");
  assert.equal(outcome(track(), options({ entitlements })).reason, "OUTPUT_NOT_PERMITTED");
});

test("normal core and subscriber music remain distinct source categories without relabelling", () => {
  for (const change of [record => { record.mediaAsset.licensedCatalogue = false; },
    record => { record.mediaAsset.libraryType = "ORGANISATION_MUSIC"; record.mediaAsset.organisationId = ORG; },
    record => { record.mediaAsset.licensedCatalogue = undefined; }, record => { record.mediaAsset = null; }]) {
    denyMutation(change, "NOT_LICENSED_MANUAL_CATALOGUE");
  }
});

test("supplier origins and an omitted distributor/provider projection always fail closed", () => {
  for (const change of [record => { record.catalogueProvider = "PROMO_ONLY"; }, record => { record.catalogueProvider = "OTHER_PROVIDER"; },
    record => { record.catalogueProvider = undefined; }, record => { record.rightsBasis = "DISTRIBUTOR_LICENCE"; },
    record => { delete record.distributorItems; }, record => { record.distributorItems = null; },
    record => { record.distributorItems = [{ id: "provider-item", status: "ACTIVE", autoDjReady: true }]; }]) {
    denyMutation(change, "PROVIDER_OUTPUT_UNAVAILABLE");
  }
});

test("immutable catalogue identity, positive bounded size and verified integral duration are required", () => {
  for (const change of [record => { record.id = "bad"; }, record => { record.mediaAssetId = "cmforeignasset0000001"; },
    record => { record.mediaAsset.storageKey = "https://example.invalid/song.mp3"; },
    record => { record.mediaAsset.storageKey = `catalogue/music/${"a".repeat(64)}.mp3?download=1`; },
    record => { record.mediaAsset.storageKey = `organisations/${ORG}/music/${"a".repeat(64)}.mp3`; },
    record => { record.mediaAsset.storageKey = `catalogue/music/${"a".repeat(64)}.exe`; },
    record => { record.mediaAsset.sizeBytes = 0n; }, record => { record.mediaAsset.sizeBytes = 50 * 1024 * 1024 + 1; },
    record => { record.mediaAsset.sizeBytes = "1e6"; }, record => { record.mediaAsset.sizeBytes = NaN; },
    record => { record.mediaAsset.durationSeconds = "181"; }, record => { record.mediaAsset.durationSeconds = 0; },
    record => { record.mediaAsset.durationSeconds = 181.5; }, record => { record.mediaAsset.durationSeconds = 86_401; },
    record => { record.title = " "; }, record => { record.artist = "a".repeat(201); }]) denyMutation(change, "TRACK_IDENTITY_INVALID");
  for (const bytes of [1_000_000n, 1_000_000, "1000000", 50n * 1024n * 1024n]) {
    const record = track(); record.mediaAsset.sizeBytes = bytes; assert.equal(outcome(record).allowed, true);
  }
  for (const extension of ["mp3", "wav", "m4a", "ogg"]) {
    const record = track(); record.mediaAsset.storageKey = `catalogue/music/${"b".repeat(64)}.${extension}`;
    assert.equal(outcome(record).allowed, true);
  }
});

test("cross-tenant masters, draft tracks and unavailable media cannot pass", () => {
  denyMutation(record => { record.mediaAsset.organisationId = ORG; }, "CATALOGUE_OWNERSHIP_INVALID");
  denyMutation(record => { record.status = "DRAFT"; }, "TRACK_NOT_READY");
  denyMutation(record => { record.mediaAsset.status = "PROCESSING"; }, "MEDIA_NOT_READY");
  denyMutation(record => { record.mediaAsset.mediaType = "PROMO"; }, "MEDIA_NOT_READY");
  assert.equal(outcome(track(), options({ organisationId: "" })).reason, "ORGANISATION_SCOPE_INVALID");
});

test("confirmed and approved rights require present actors, recorded declarations and non-future timestamps", () => {
  for (const change of [record => { record.rightsReviewStatus = "IN_REVIEW"; }, record => { record.rightsConfirmedAt = null; },
    record => { record.rightsReviewedAt = undefined; }, record => { record.rightsReviewedById = null; },
    record => { record.rightsConfirmedById = "bad"; }, record => { record.rightsHolder = " "; },
    record => { record.rightsReference = ""; }, record => { record.rightsBasis = "UNVERIFIED"; },
    record => { record.rightsReviewedAt = new Date(NOW.getTime() + 1); },
    record => { record.rightsConfirmedAt = "2026-02-30T00:00:00.000Z"; }]) denyMutation(change, "RIGHTS_DECLARATION_REQUIRED");
  for (const basis of ["OWNED_MASTER", "DIRECT_LICENCE", "OTHER"]) {
    const record = track(); record.rightsBasis = basis; assert.equal(outcome(record).allowed, true);
  }
});

test("ONLINE pillar and a concrete licensed country are mandatory; no empty or broad context fallback", () => {
  for (const uses of [[], ["RETAIL_RADIO"], "ONLINE_RADIO", ["ONLINE_RADIO", null]]) {
    denyMutation(record => { record.permittedUses = uses; }, "USE_NOT_PERMITTED");
  }
  for (const territory of [null, undefined, "", "WORLDWIDE", "EUROPE", "mt", "USA"]) {
    assert.equal(outcome(track(), options({ territory })).reason, "TERRITORY_REQUIRED");
  }
  assert.equal(outcome(track(), options({ territory: "US" })).reason, "RIGHTS_NOT_APPROVED");
  for (const permittedTerritories of ["", "EUROPE,INVALID", "WORLDWIDE,MT", null]) {
    denyMutation(record => { record.permittedTerritories = permittedTerritories; }, "TERRITORY_REQUIRED");
  }
  const worldwide = track(); worldwide.permittedTerritories = "WORLDWIDE";
  assert.equal(outcome(worldwide, options({ territory: "US" })).allowed, true);
});

test("track and genre tiers follow real entitlement level; approved active genres cannot be bypassed", () => {
  denyMutation(record => { record.minimumCatalogueLevel = "PREMIUM"; }, "CATALOGUE_TIER_REQUIRED");
  denyMutation(record => { record.minimumCatalogueLevel = undefined; }, "CATALOGUE_TIER_REQUIRED");
  for (const change of [record => { record.mediaAsset.genres = []; }, record => { record.mediaAsset.genres = [null, {}]; },
    record => { record.mediaAsset.genres[0].mediaGenre.active = false; },
    record => { record.mediaAsset.genres[0].mediaGenre.providerReviewStatus = "PENDING"; },
    record => { record.mediaAsset.genres[0].mediaGenre.minimumCatalogueLevel = "PREMIUM"; },
    record => { record.mediaAsset.genres[0].mediaGenre = genre("country", { minimumCatalogueLevel: "PROFESSIONAL" }); }]) {
    denyMutation(change, "CATALOGUE_GENRE_LOCKED");
  }
  const context = options(); Object.assign(context.entitlements, { licensedMusicCatalogueLevel: "PREMIUM", planCode: "ONLINE_RADIO_TIER_5" });
  const premium = track(); premium.minimumCatalogueLevel = "PREMIUM";
  premium.mediaAsset.genres = [{ mediaGenre: genre("original-genre", { minimumCatalogueLevel: "PREMIUM" }) }];
  context.configuredGenres = [genre("original-genre", { minimumCatalogueLevel: "PREMIUM" })];
  assert.equal(outcome(premium, context).allowed, true);
  assert.equal(outcome(premium, { ...context, configuredGenres: [] }).reason, "CATALOGUE_GENRE_LOCKED");
  const professional = track(); professional.minimumCatalogueLevel = "PROFESSIONAL";
  professional.mediaAsset.genres = [{ mediaGenre: genre("country", { minimumCatalogueLevel: "PROFESSIONAL" }) }];
  context.entitlements.licensedMusicCatalogueLevel = "PROFESSIONAL";
  assert.equal(outcome(professional, context).allowed, true);
});

test("selected genres narrow but never broaden the approved catalogue scope", () => {
  assert.equal(outcome(track(), options({ selectedGenreCodes: ["DANCE"] })).reason, "GENRE_NOT_SELECTED");
  assert.equal(outcome(track(), options({ selectedGenreCodes: ["POP"] })).allowed, true);
  for (const selectedGenreCodes of ["POP", [null], [""], new Array(25).fill("POP")]) {
    assert.equal(outcome(track(), options({ selectedGenreCodes })).reason, "GENRE_SELECTION_INVALID");
  }
  for (const configuredGenres of [null, [null], ["pop"], new Array(251).fill(genre())]) {
    assert.equal(outcome(track(), options({ configuredGenres })).reason, "INVALID_GENRES");
  }
});

test("whole proposed windows respect canonical inclusive UTC expiry and exclusive stop semantics", () => {
  const record = track(); record.licenceExpiresAt = new Date("2026-10-21T00:00:00.000Z");
  const midnight = new Date("2026-10-22T00:00:00.000Z");
  assert.equal(outcome(record, options({ stopAt: midnight })).allowed, true);
  assert.equal(outcome(record, options({ stopAt: new Date(midnight.getTime() + 1) })).reason, "RIGHTS_WINDOW_INACTIVE");
  record.licenceExpiresAt = new Date("2026-10-20T00:00:00.000Z");
  assert.equal(outcome(record).reason, "RIGHTS_WINDOW_INACTIVE");
  record.licenceExpiresAt = null; record.licenceStartsAt = new Date("2026-10-22T00:00:00.000Z");
  assert.equal(outcome(record).reason, "RIGHTS_WINDOW_INACTIVE");
});

test("missing, invalid or coerced dates cannot become an indefinite licence or a valid window", () => {
  for (const extra of [{ instant: undefined }, { instant: 0 }, { instant: new Date(NaN) }, { stopAt: null },
    { stopAt: NOW }, { stopAt: EARLIER }, { stopAt: "2026-02-30T00:00:00.000Z" }]) {
    assert.equal(outcome(track(), options(extra)).reason, "RIGHTS_WINDOW_INACTIVE");
  }
  for (const field of ["licenceStartsAt", "licenceExpiresAt"]) for (const value of [undefined, "", new Date(NaN), "2026-02-30T00:00:00.000Z"]) {
    denyMutation(record => { record[field] = value; }, "RIGHTS_WINDOW_INACTIVE");
  }
  const record = track(); record.licenceExpiresAt = null;
  assert.equal(outcome(record, options({ instant: NOW.toISOString(), stopAt: new Date(NOW.getTime() + 600_000).toISOString() })).allowed, true);
});

test("filter reports fixed exclusion counts, preserves weights/repeats and never mutates inputs", () => {
  const good = { track: track(), weight: 75, position: 3 }, bad = structuredClone(good);
  bad.track.rightsReviewStatus = "REJECTED";
  const entries = [good, bad, good], context = options(), before = structuredClone({ entries, context });
  const result = filterLicensedManualCatalogueEntries(entries, context);
  assert.deepEqual(result.excludedReasons, { RIGHTS_DECLARATION_REQUIRED: 1 });
  assert.deepEqual(result.entries, [good, good]); assert.equal(result.entries[0], good);
  assert.equal(result.entries[0].track.mediaAsset.licensedCatalogue, true);
  assert.deepEqual({ entries, context }, before);
  assert.deepEqual(filterLicensedManualCatalogueEntries(entries, { ...context, enabled: false }), {
    entries: [], excludedReasons: { MANUAL_CATALOGUE_DISABLED: 3 } });
  for (const invalid of [null, {}, new Array(5001).fill(good)]) assert.deepEqual(filterLicensedManualCatalogueEntries(invalid, context), {
    entries: [], excludedReasons: { INVALID_ENTRIES: 1 } });
});

test("the new eligibility module has no clients, credentials, worker execution or side-effectful imports", () => {
  const source = readFileSync(new URL("../lib/online-radio-catalogue-policy.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|fetch\s*\(|Prisma|prisma|GetObject|PutObject|spawn\s*\(|decryptSecret|\.\/.*service/);
  assert.match(source, /musicTrackEligibility/);
});
