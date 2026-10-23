import test from "node:test";
import assert from "node:assert/strict";
import { TEST_RADIO_CONTINUOUS as P, continuousSourceReady, continuousSourceFingerprint, signContinuousCommand,
  verifyContinuousCommand, continuousChargedBytes, continuousBudgetMonth, continuousStationDecision } from "../lib/test-radio-continuous-policy.mjs";

const env = { SECRET_ENCRYPTION_KEY: "10".repeat(32) };
const source = () => ({ providerKey: "CENTOVA_CAST", streamUrl: P.listenerUrl, serverHost: P.host, serverPort: P.port,
  sourcePort: P.port, sourceUsername: null, centovaUsername: P.account, bitrateKbps: 128,
  sourcePasswordEncrypted: "test-only-encrypted-placeholder", outboundAutoDjEnabled: false });
test("continuous target cannot escape this exact account, HTTPS listener, port or bitrate", () => {
  assert.equal(continuousSourceReady(source()), true);
  for (const change of [{ streamUrl: "https://other.example/stream" }, { sourcePort: 8393 }, { serverPort: 8393 },
    { serverHost: "other.example" }, { centovaUsername: "radio105" }, { bitrateKbps: 320 }, { sourceUsername: "root" },
    { outboundAutoDjEnabled: true }, { lastError: "CONTINUOUS_STOP_UNCONFIRMED" }, { lastError: "CATALOGUE_TEST_STOP_UNCONFIRMED" }]) {
    assert.equal(continuousSourceReady({ ...source(), ...change }), false);
  }
});
test("source fingerprints bind credentials without exposing them and ignore lease renewal", () => {
  assert.match(continuousSourceFingerprint(source()), /^[a-f0-9]{64}$/);
  assert.equal(continuousSourceFingerprint(source()), continuousSourceFingerprint({ ...source(), encoderLeaseOwner: "changed" }));
  assert.notEqual(continuousSourceFingerprint(source()), continuousSourceFingerprint({ ...source(), sourcePasswordEncrypted: "different" }));
});
test("signed owner grant is canonical, secret domain separated and tamper evident", () => {
  const command = { action: "START", nested: { z: 2, a: 1 }, stationId: P.stationId };
  const signature = signContinuousCommand(command, env);
  assert.equal(verifyContinuousCommand({ command: { stationId: P.stationId, nested: { a: 1, z: 2 }, action: "START" }, signature }, env), true);
  assert.equal(verifyContinuousCommand({ command: { ...command, stationId: "other" }, signature }, env), false);
  assert.equal(verifyContinuousCommand({ command, signature }, { SECRET_ENCRYPTION_KEY: "20".repeat(32) }), false);
  assert.equal(verifyContinuousCommand({ command, signature: "bad" }, env), false);
  assert.throws(() => signContinuousCommand(command, {}), { code: "CONTINUOUS_SIGNING_UNAVAILABLE" });
});
test("cost allocation is conservative, bounded, calendar scoped and under $15 before taxes", () => {
  assert.equal(continuousChargedBytes(960_000), 1_008_000);
  for (const bytes of [0, -1, 1.5, Infinity, P.maximumReservationBytes + 1]) assert.throws(() => continuousChargedBytes(bytes));
  assert.equal(continuousBudgetMonth(new Date("2026-10-31T23:59:59Z")), "2026-10");
  assert.equal(continuousBudgetMonth(new Date("2026-11-01T00:00:00Z")), "2026-11");
  assert.ok(P.monthlyComputeUsd + P.monthlyOtherReserveUsd + P.monthlyReservedBytes / 1e9 * P.bandwidthUsdPerGB < 15);
  assert.ok(128000 / 8 * 86400 * 31 * P.wireMultiplier < P.monthlyReservedBytes);
});
test("station policy leaves ordinary sandbox and public-player permission unchanged", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  const context = { station: { id: P.stationId, organisationId: "cmorganisation0001", productFamily: "ONLINE", status: "DRAFT",
    publicPlayerEnabled: false, stationWebsiteEnabled: false, streamConfig: source() },
    entitlements: { serviceEnabled: true, onlineRadioEnabled: true, sandboxDraftOnly: true }, serviceExpiresAt: new Date("2026-11-23T00:00:00Z") };
  assert.equal(continuousStationDecision(context, now), null);
  assert.equal(continuousStationDecision({ ...context, serviceExpiresAt: null }, now), "CONTINUOUS_SERVICE_INACTIVE");
  assert.equal(continuousStationDecision({ ...context, station: { ...context.station, publicPlayerEnabled: true } }, now), "CONTINUOUS_SCOPE_CHANGED");
  assert.equal(context.entitlements.sandboxDraftOnly, true);
  assert.equal(context.station.streamConfig.outboundAutoDjEnabled, false);
});
