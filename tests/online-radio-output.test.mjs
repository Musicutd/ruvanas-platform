import assert from "node:assert/strict";
import test from "node:test";
import { eligibleOnlineRadioRotation, liquidsoapScript, rotationFingerprint } from "../lib/online-radio-output.mjs";

const instant = new Date("2026-09-18T12:00:00Z");
const baseTrack = (overrides = {}) => ({
  id: "track-1", status: "READY", updatedAt: instant, licenceStartsAt: null, licenceExpiresAt: null,
  mediaAsset: { id: "asset-1", updatedAt: instant, status: "READY", mediaType: "MUSIC", libraryType: "RUVANAS_CATALOGUE", organisationId: null, licensedCatalogue: false, durationSeconds: 180, storageKey: "test.mp3" },
  ...overrides
});
const station = (track = baseTrack(), overrides = {}) => ({
  id: "station-1", organisationId: "org-1", productFamily: "ONLINE", status: "PENDING_SETUP", name: "Test Station",
  streamConfig: { outboundAutoDjEnabled: true, providerKey: "CENTOVA_CAST", serverHost: "stream.example.com", sourcePort: 8394, sourceUsername: "source", sourcePasswordEncrypted: "ciphertext", bitrateKbps: 128 },
  channels: [{ id: "channel-1", status: "ACTIVE", autoDjPolicy: { enabled: true, state: "ACTIVE", playbackPolicy: "RUN_24_7", rightsUse: "ONLINE_RADIO", sourceScopes: ["RUVANAS_CORE"], selectedGenreCodes: [], defaultMusicMode: { id: "mode-1", status: "ACTIVE", tracks: [{ track, weight: 100, position: 1 }] }, backupMusicMode: null, updatedAt: instant } }],
  ...overrides
});
const entitlements = { onlineRadioEnabled: true, licensedMusicCatalogueLevel: "NONE" };

test("Online Radio can prepare a rights-eligible rotation before the listener stream is live", () => {
  const result = eligibleOnlineRadioRotation(station(), entitlements, instant);
  assert.equal(result.ready, true);
  assert.equal(result.entries.length, 1);
  assert.match(rotationFingerprint(result), /^[0-9a-f]{64}$/);
  const sourcePasswordOnly = station();
  sourcePasswordOnly.streamConfig.sourceUsername = null;
  assert.equal(eligibleOnlineRadioRotation(sourcePasswordOnly, entitlements, instant).ready, true);
});

test("encoder refuses inactive service, wrong product, disabled output and paused policy", () => {
  assert.equal(eligibleOnlineRadioRotation(station(), { ...entitlements, onlineRadioEnabled: false }, instant).reason, "SERVICE_INACTIVE");
  assert.equal(eligibleOnlineRadioRotation(station(baseTrack(), { productFamily: "RETAIL" }), entitlements, instant).reason, "STATION_NOT_READY");
  assert.equal(eligibleOnlineRadioRotation(station(baseTrack(), { streamConfig: { outboundAutoDjEnabled: false } }), entitlements, instant).reason, "SOURCE_NOT_CONFIGURED");
  const paused = station(); paused.channels[0].autoDjPolicy.state = "PAUSED";
  assert.equal(eligibleOnlineRadioRotation(paused, entitlements, instant).reason, "AUTODJ_NOT_ACTIVE");
});

test("encoder fails closed when approved audio is unavailable or source scope excludes it", () => {
  assert.equal(eligibleOnlineRadioRotation(station(baseTrack({ status: "DRAFT" })), entitlements, instant).reason, "NO_RIGHTS_APPROVED_AUDIO");
  const excluded = station(); excluded.channels[0].autoDjPolicy.sourceScopes = ["SUBSCRIBER_LIBRARY"];
  assert.equal(eligibleOnlineRadioRotation(excluded, entitlements, instant).reason, "NO_RIGHTS_APPROVED_AUDIO");
  const licensed = station(baseTrack({ mediaAsset: { ...baseTrack().mediaAsset, licensedCatalogue: true } }));
  licensed.channels[0].autoDjPolicy.sourceScopes = ["LICENSED_CATALOGUE"];
  assert.equal(eligibleOnlineRadioRotation(licensed, { ...entitlements, licensedMusicCatalogueLevel: "PREMIUM" }, instant).reason, "NO_RIGHTS_APPROVED_AUDIO");
});

test("Liquidsoap script uses an explicit source port and escapes source values", () => {
  const script = liquidsoapScript({ playlistPath: "/tmp/rotation.m3u", host: "203.0.113.1", port: 8394, username: "source", password: "a\"b", bitrateKbps: 128, stationName: "Test" });
  assert.match(script, /output\.shoutcast/);
  assert.match(script, /port=8394/);
  assert.match(script, /password="a\\"b"/);
  assert.match(script, /fallible=true/);
  assert.doesNotMatch(script, /mksafe/);
  const directSource = liquidsoapScript({ playlistPath: "/tmp/rotation.m3u", host: "88.198.70.25", port: 8393, username: null, password: "hidden", bitrateKbps: 128, stationName: "Test" });
  assert.match(directSource, /port=8393/);
  assert.doesNotMatch(directSource, /user=/);
  assert.doesNotMatch(directSource, /port=8395/);
  assert.throws(() => liquidsoapScript({ playlistPath: "x", host: "x", port: 0, username: "x", password: "x", bitrateKbps: 128, stationName: "x" }));
});
