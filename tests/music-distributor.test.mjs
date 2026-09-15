import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDistributorUsageReport,
  distributorApiUrl,
  distributorDuplicateKey,
  distributorReconciliationAction,
  distributorRetryDelayMs,
  distributorTrackDecision,
  parseDistributorCataloguePage,
  parseDistributorConnection,
  validateDistributorEndpoint
} from "../lib/music-distributor.mjs";

const connection = {
  id: "connection-1",
  providerKey: "EXAMPLE",
  apiBaseUrl: "https://catalogue.example.test/api/",
  defaultMinimumCatalogueLevel: "FOCUSED",
  defaultPermittedTerritories: ["MT", "GB"],
  defaultPermittedUses: ["RETAIL_RADIO"]
};

const track = (overrides = {}) => ({
  id: "track-1",
  recordingId: "recording-1",
  releaseId: "release-1",
  collectionIds: ["focused"],
  isrc: "MT-ABC-26-00001",
  title: "Example Song",
  artist: "Example Artist",
  album: "Example Album",
  label: "Example Label",
  genres: ["Pop"],
  explicit: false,
  delivery: {
    mode: "PROTECTED_STREAM",
    url: "https://media.example.test/tracks/1",
    checksumSha256: "a".repeat(64),
    mimeType: "audio/mpeg",
    sizeBytes: 12345
  },
  minimumCatalogueLevel: "FOCUSED",
  permittedTerritories: ["MT", "GB"],
  permittedUses: ["RETAIL_RADIO"],
  licenceStartsAt: "2026-01-01",
  licenceExpiresAt: "2027-01-01",
  rightsHolder: "Example Rights Holder",
  rightsReference: "agreement-2026",
  status: "ACTIVE",
  takedownReason: null,
  ...overrides
});

test("OAuth client-credential configuration is strict and endpoint-safe", () => {
  const result = parseDistributorConnection({
    name: "Example distributor",
    providerKey: "example",
    apiBaseUrl: "https://catalogue.example.test/api",
    tokenUrl: "https://identity.example.test/oauth/token",
    cataloguePath: "/v1/catalogue",
    usageReportPath: "/v1/usage",
    clientId: "ruvanas",
    clientSecret: "a-strong-client-secret",
    oauthScopes: ["catalogue.read", "usage.write"],
    defaultMinimumCatalogueLevel: "FOCUSED",
    defaultPermittedTerritories: ["MT"],
    defaultPermittedUses: ["RETAIL_RADIO"],
    syncIntervalMinutes: 60
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.providerKey, "EXAMPLE");
  assert.throws(() => validateDistributorEndpoint("http://localhost/catalogue"), /HTTPS/);
  assert.throws(() => validateDistributorEndpoint("https://127.0.0.1/catalogue"), /private or local/);
  assert.equal(distributorApiUrl(connection, "/v1/catalogue", { cursor: "next" }), "https://catalogue.example.test/v1/catalogue?cursor=next");
});

test("catalogue pages normalize releases, identifiers, tiers, rights, and delivery", () => {
  const result = parseDistributorCataloguePage({
    cursor: "next-page",
    hasMore: true,
    releases: [{ id: "release-1", title: "Example Release", label: "Example Label", releaseDate: "2026-09-15", status: "ACTIVE" }],
    collections: [{ id: "focused", name: "Focused", minimumCatalogueLevel: "FOCUSED", permittedTerritories: ["MT"], permittedUses: ["RETAIL_RADIO"], active: true }],
    tracks: [track()]
  }, connection);
  assert.equal(result.ok, true);
  assert.equal(result.data.tracks[0].isrc, "MTABC2600001");
  assert.match(result.data.tracks[0].metadataChecksum, /^[0-9a-f]{64}$/);
  assert.equal(typeof result.data.tracks[0].delivery.sizeBytes, "bigint");
});

test("collection grants provide tier, territory and product-use defaults to their tracks", () => {
  const result = parseDistributorCataloguePage({
    collections: [{ id: "premium-set", name: "Premium set", minimumCatalogueLevel: "PREMIUM", permittedTerritories: ["US"], permittedUses: ["ONLINE_RADIO"], active: true }],
    tracks: [track({ minimumCatalogueLevel: undefined, permittedTerritories: [], permittedUses: [], collectionIds: ["premium-set"] })]
  }, connection);
  assert.equal(result.ok, true);
  assert.equal(result.data.tracks[0].minimumCatalogueLevel, "PREMIUM");
  assert.deepEqual(result.data.tracks[0].permittedTerritories, ["US"]);
  assert.deepEqual(result.data.tracks[0].permittedUses, ["ONLINE_RADIO"]);
});

test("invalid rights windows and duplicate payload identifiers fail closed", () => {
  const badWindow = parseDistributorCataloguePage({ tracks: [track({ licenceStartsAt: "2027-01-01", licenceExpiresAt: "2026-01-01" })] }, connection);
  assert.equal(badWindow.ok, false);
  const duplicate = parseDistributorCataloguePage({ tracks: [track(), track()] }, connection);
  assert.equal(duplicate.ok, false);
});

test("tier, territory, use, licence and takedown decisions are enforced", () => {
  const normalized = parseDistributorCataloguePage({ tracks: [track()] }, connection).data.tracks[0];
  assert.equal(distributorTrackDecision(normalized, { catalogueLevel: "FOCUSED", territory: "MT", rightsUse: "RETAIL_RADIO", instant: new Date("2026-09-15") }).playable, true);
  assert.equal(distributorTrackDecision(normalized, { catalogueLevel: "NONE", territory: "MT", rightsUse: "RETAIL_RADIO" }).reason, "CATALOGUE_TIER_REQUIRED");
  assert.equal(distributorTrackDecision(normalized, { catalogueLevel: "FOCUSED", territory: "US", rightsUse: "RETAIL_RADIO" }).reason, "TERRITORY_NOT_PERMITTED");
  assert.equal(distributorTrackDecision(normalized, { catalogueLevel: "FOCUSED", territory: "MT", rightsUse: "ONLINE_RADIO" }).reason, "USE_NOT_PERMITTED");
  assert.equal(distributorTrackDecision({ ...normalized, status: "TAKEN_DOWN" }, { catalogueLevel: "PREMIUM" }).reason, "DISTRIBUTOR_TRACK_INACTIVE");
});

test("reconciliation distinguishes metadata, rights, takedown, and restore changes", () => {
  const base = { status: "ACTIVE", metadataChecksum: "a", minimumCatalogueLevel: "FOCUSED", permittedTerritories: ["MT"], permittedUses: ["RETAIL_RADIO"], rightsHolder: "A", rightsReference: "1" };
  assert.equal(distributorReconciliationAction(null, base), "CREATED");
  assert.equal(distributorReconciliationAction(base, base), "UNCHANGED");
  assert.equal(distributorReconciliationAction(base, { ...base, metadataChecksum: "b", rightsReference: "2" }), "RIGHTS_CHANGED");
  assert.equal(distributorReconciliationAction(base, { ...base, status: "TAKEN_DOWN", metadataChecksum: "b" }), "TAKEN_DOWN");
  assert.equal(distributorReconciliationAction({ ...base, status: "TAKEN_DOWN" }, { ...base, status: "ACTIVE", metadataChecksum: "b" }), "RESTORED");
  assert.equal(distributorReconciliationAction(base, { ...base, status: "UNAVAILABLE", metadataChecksum: "b" }), "UNAVAILABLE");
});

test("a release takedown makes its supplied tracks ineligible in the same response", () => {
  const result = parseDistributorCataloguePage({
    releases: [{ id: "release-1", title: "Removed release", status: "TAKEN_DOWN" }],
    tracks: [track({ status: "ACTIVE" })]
  }, connection);
  assert.equal(result.ok, true);
  assert.equal(result.data.tracks[0].status, "TAKEN_DOWN");
  assert.equal(result.data.tracks[0].takedownReason, "Distributor release takedown");
});

test("duplicate detection and retry backoff are deterministic", () => {
  assert.equal(distributorDuplicateKey({ sourceChecksumSha256: "a".repeat(64) }), `SHA256:${"a".repeat(64)}`);
  assert.equal(distributorDuplicateKey({ isrc: "MT-ABC-26-00001" }), "ISRC:MTABC2600001");
  assert.equal(distributorRetryDelayMs(1), 30_000);
  assert.equal(distributorRetryDelayMs(8), 3_840_000);
});

test("usage reports expose provider identifiers and operational evidence without tenant identities", () => {
  const event = { id: "event-1", trackId: "track-db-1", occurredAt: new Date("2026-09-15T10:00:00Z"), durationSeconds: 180, territoryCode: "MT", rightsUse: "RETAIL_RADIO" };
  const result = buildDistributorUsageReport({
    connection,
    periodFrom: "2026-09-01T00:00:00Z",
    periodUntil: "2026-10-01T00:00:00Z",
    events: [event],
    mappings: new Map([["track-db-1", { externalTrackId: "track-1", isrc: "MTABC2600001" }]])
  });
  assert.equal(result.report.rows[0].distributorTrackId, "track-1");
  assert.doesNotMatch(JSON.stringify(result.report), /organisation|email|listener/i);
  assert.match(result.payloadSha256, /^[0-9a-f]{64}$/);
});
