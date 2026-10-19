import assert from "node:assert/strict";
import test from "node:test";
import { eligibleScheduledOnlineRotation } from "../lib/online-radio-output.mjs";

const instant = new Date("2026-10-18T12:00:00.000Z");
const entries = [{
  track: {
    id: "synthetic-track", artist: "Synthetic artist",
    mediaAsset: { libraryType: "ORGANISATION_MUSIC", durationSeconds: 180, sizeBytes: 1000 }
  },
  genreCodes: ["POP"]
}];
const entitlements = { onlineRadioEnabled: true, outputEnabled: true };
const event = {
  id: "synthetic-event", organisationId: "synthetic-org", channelId: "synthetic-channel",
  startsAt: new Date("2026-10-18T11:00:00.000Z"), endsAt: new Date("2026-10-18T13:00:00.000Z"),
  smartPlaylist: {
    id: "synthetic-playlist", organisationId: "synthetic-org", status: "ACTIVE",
    rightsUse: "ONLINE_RADIO", genreCodes: ["POP"], simpleBuildMode: "RANDOM_GENRE_POOL",
    durationMinutes: 60, version: 1, updatedAt: instant, musicModeId: "synthetic-mode"
  }
};

function station(status = "ACTIVE") {
  return {
    id: "synthetic-station", organisationId: "synthetic-org", productFamily: "ONLINE", status,
    streamConfig: {
      outboundAutoDjEnabled: true, providerKey: "CENTOVA_CAST", serverHost: "example.invalid",
      sourcePort: 8000, sourcePasswordEncrypted: "synthetic-placeholder"
    },
    channels: [{ id: "synthetic-channel", organisationId: "synthetic-org", status: "ACTIVE" }]
  };
}

test("scheduled output rejects paused, suspended and cancelled stations before building audio", () => {
  for (const status of ["PAUSED", "SUSPENDED", "CANCELLED"]) {
    const result = eligibleScheduledOnlineRotation(station(status), entitlements, event, entries, instant);
    assert.equal(result.ready, false, `${status} station must not supply scheduled output`);
    assert.equal(result.reason, "STATION_NOT_READY");
    assert.equal(result.entries, undefined);
  }
});

test("scheduled output preserves the continuous encoder's allowed station states", () => {
  for (const status of ["PENDING_SETUP", "DRAFT", "ACTIVE"]) {
    const result = eligibleScheduledOnlineRotation(station(status), entitlements, event, entries, instant);
    assert.equal(result.ready, true, `${status} preparation remains allowed by the existing contract`);
    assert.ok(result.entries.length > 0);
  }
});

test("scheduled output fails closed for missing station state, product and output entitlement", () => {
  for (const value of [null, undefined, { ...station(), status: undefined }, station(null), station("UNKNOWN"), { ...station(), productFamily: "RETAIL" }]) {
    const result = eligibleScheduledOnlineRotation(value, entitlements, event, entries, instant);
    assert.equal(result.ready, false);
    assert.equal(result.reason, "STATION_NOT_READY");
  }
  assert.equal(eligibleScheduledOnlineRotation(station(), { ...entitlements, outputEnabled: false }, event, entries, instant).reason, "OUTPUT_NOT_PERMITTED");
  assert.equal(eligibleScheduledOnlineRotation(station(), { ...entitlements, onlineRadioEnabled: false }, event, entries, instant).ready, false);
  assert.equal(eligibleScheduledOnlineRotation(station(), null, event, entries, instant).ready, false);
});
