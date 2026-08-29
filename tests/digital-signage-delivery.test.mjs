import test from "node:test";
import assert from "node:assert/strict";

import {
  appendDigitalSignageEvent,
  buildDigitalSignageManifest,
  createDigitalSignageProofToken,
  isDigitalSignagePlaylistActive,
  normaliseDigitalSignageTakeover,
  normaliseDigitalSignagePlaylist,
  removeDigitalSignageEvents,
  selectDigitalSignagePlaylist,
  selectDigitalSignageTakeover,
  verifyDigitalSignageProofToken
} from "../lib/digital-signage-delivery.mjs";

const secret = "digital-signage-proof-secret-at-least-32-characters";

function playlist(overrides = {}) {
  return {
    id: "playlist_1",
    organisationId: "org_1",
    name: "Entrance visuals",
    status: "PUBLISHED",
    version: 2,
    startsAt: null,
    endsAt: null,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    dailyStartMinute: 0,
    dailyEndMinute: 1440,
    priority: 10,
    layout: {
      id: "layout_1",
      name: "Landscape",
      canvasWidth: 1920,
      canvasHeight: 1080,
      backgroundColor: "#000000",
      orientation: "LANDSCAPE",
      regions: [{ id: "region_1", name: "Main", x: 0, y: 0, width: 1920, height: 1080, zIndex: 0, fitMode: "COVER" }]
    },
    items: [{
      id: "item_1",
      regionId: "region_1",
      assetId: "asset_1",
      position: 0,
      durationSeconds: 10,
      asset: { id: "asset_1", name: "Welcome", kind: "IMAGE", mimeType: "image/png", width: 1920, height: 1080, checksumSha256: "a".repeat(64), storageKey: "must-not-leak" }
    }],
    ...overrides
  };
}

const device = {
  id: "device_1",
  name: "Entrance display",
  viewportWidth: 1920,
  viewportHeight: 1080,
  orientation: "LANDSCAPE",
  zone: { name: "Entrance", location: { name: "Valletta", timezone: "Europe/Malta" } }
};

test("visual playlist input binds tenant layout, assets, regions, and devices", () => {
  const value = normaliseDigitalSignagePlaylist({
    organisationId: "org_1",
    layoutId: "layout_1",
    name: "Morning screen",
    deviceIds: ["device_1", "device_1"],
    dailyStart: "06:00",
    dailyEnd: "12:00",
    items: [{ regionId: "region_1", assetId: "asset_1", durationSeconds: 12 }]
  });
  assert.deepEqual(value.deviceIds, ["device_1"]);
  assert.equal(value.dailyStartMinute, 360);
  assert.equal(value.dailyEndMinute, 720);
  assert.equal(value.items[0].position, 0);
  assert.throws(() => normaliseDigitalSignagePlaylist({ organisationId: "org_1", layoutId: "layout_1", name: "Unsafe", deviceIds: [], items: [] }), /device/);
});

test("daily scheduling supports timezone-aware overnight windows", () => {
  const overnight = playlist({ activeDays: [1], dailyStartMinute: 22 * 60, dailyEndMinute: 2 * 60 });
  assert.equal(isDigitalSignagePlaylistActive(overnight, new Date("2026-08-24T21:00:00.000Z"), "Europe/Malta"), true);
  assert.equal(isDigitalSignagePlaylistActive(overnight, new Date("2026-08-24T23:00:00.000Z"), "Europe/Malta"), true);
  assert.equal(isDigitalSignagePlaylistActive(overnight, new Date("2026-08-25T02:30:00.000Z"), "Europe/Malta"), false);
});

test("the highest-priority active playlist wins deterministically", () => {
  const selected = selectDigitalSignagePlaylist([playlist(), playlist({ id: "playlist_2", priority: 50 })], new Date("2026-08-24T09:00:00.000Z"), "Europe/Malta");
  assert.equal(selected.id, "playlist_2");
});

test("takeovers are bounded, explicit, and win over scheduled playlists", () => {
  const input = normaliseDigitalSignageTakeover({ organisationId: "org_1", playlistId: "playlist_1", name: "Closure", reason: "Site closed due to weather", startsAt: "2026-08-24T09:00:00.000Z", endsAt: "2026-08-24T10:00:00.000Z", deviceIds: ["device_1", "device_1"] });
  assert.deepEqual(input.deviceIds, ["device_1"]);
  assert.throws(() => normaliseDigitalSignageTakeover({ ...input, endsAt: "2026-08-26T10:00:00.000Z" }), /24 hours/);
  const takeover = { id: "takeover_1", status: "ACTIVE", startsAt: input.startsAt, endsAt: input.endsAt, activatedAt: input.startsAt, playlist: playlist({ id: "urgent", priority: 0 }) };
  assert.equal(selectDigitalSignageTakeover([takeover], new Date("2026-08-24T09:30:00.000Z")).id, "takeover_1");
  const manifest = buildDigitalSignageManifest({ device, playlists: [playlist({ priority: 100 })], takeovers: [takeover], proofSecret: secret, instant: new Date("2026-08-24T09:30:00.000Z") });
  assert.equal(manifest.deliveryClass, "EMERGENCY_TAKEOVER");
  assert.equal(manifest.playlist.id, "urgent");
  assert.ok(new Date(manifest.offlineGraceUntil) <= input.endsAt);
  assert.match(manifest.takeover.safetyNotice, /not a certified life-safety/);
});

test("signage manifest is signed, expiring, offline-safe, and hides storage keys", () => {
  const manifest = buildDigitalSignageManifest({ device, playlists: [playlist()], proofSecret: secret, instant: new Date("2026-08-24T09:02:00.000Z") });
  assert.equal(manifest.state, "READY");
  assert.equal(manifest.playlist.layout.regions[0].items[0].asset.mediaUrl, "/api/signage/media/asset_1");
  assert.match(manifest.playlist.layout.regions[0].items[0].proofToken, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(manifest).includes("must-not-leak"), false);
  assert.ok(new Date(manifest.offlineGraceUntil) > new Date(manifest.expiresAt));
});

test("display proof tokens reject device or asset tampering", () => {
  const input = { deviceId: "device_1", manifestVersion: "1234567890abcdef12345678", playlistItemId: "item_1", assetId: "asset_1" };
  const token = createDigitalSignageProofToken(input, secret);
  assert.equal(verifyDigitalSignageProofToken(input, token, secret), true);
  assert.equal(verifyDigitalSignageProofToken({ ...input, deviceId: "device_2" }, token, secret), false);
  assert.equal(verifyDigitalSignageProofToken({ ...input, assetId: "asset_2" }, token, secret), false);
  const commercial = { ...input, retailMediaOrderId: "order_1" };
  const commercialToken = createDigitalSignageProofToken(commercial, secret);
  assert.equal(verifyDigitalSignageProofToken(commercial, commercialToken, secret), true);
  assert.equal(verifyDigitalSignageProofToken({ ...commercial, retailMediaOrderId: "order_2" }, commercialToken, secret), false);
});

test("offline display evidence is bounded and removed only after acknowledgement", () => {
  const first = { eventId: "one" };
  const second = { eventId: "two" };
  assert.deepEqual(appendDigitalSignageEvent([first], second, 2), [first, second]);
  assert.deepEqual(appendDigitalSignageEvent([first, second], { eventId: "three" }, 2).map((event) => event.eventId), ["two", "three"]);
  assert.deepEqual(removeDigitalSignageEvents([first, second], ["one"]), [second]);
});
