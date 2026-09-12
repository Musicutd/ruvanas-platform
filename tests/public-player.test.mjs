import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildPlayerManifest } from "../lib/player-manifest.mjs";
import {
  appendPublicPlaybackToken,
  claimPublicListenerLease,
  createPublicPlaybackToken,
  normalizePublicPlayerSettings,
  publicListenerSessionHash,
  publicNowPlaying,
  verifyPublicPlaybackToken
} from "../lib/public-player.mjs";

const secret = "stage-19-14-public-player-test-secret";
const instant = new Date("2026-09-06T12:00:00.000Z");
const firstSession = "11111111-1111-4111-8111-111111111111";

function station(limit = 2) {
  return {
    id: "station-1", organisationId: "org-1", status: "ACTIVE", publicPlayerEnabled: true, listenerLimit: limit,
    organisation: { subscription: { status: "ACTIVE", plan: { active: true, code: "RADIO", onlineRadioEnabled: true, stationLimit: 1, listenerLimit: limit, storageLimitGb: 20, maxBitrateKbps: 320 } } }
  };
}

function memoryDatabase() {
  const leases = [];
  const model = {
    async deleteMany({ where }) { const before = leases.length; for (let i = leases.length - 1; i >= 0; i -= 1) if (leases[i].stationId === where.stationId && leases[i].expiresAt <= where.expiresAt.lte) leases.splice(i, 1); return { count: before - leases.length }; },
    async findUnique({ where }) { const key = where.stationId_sessionHash; return leases.find((item) => item.stationId === key.stationId && item.sessionHash === key.sessionHash) || null; },
    async update({ where, data }) { const lease = leases.find((item) => item.id === where.id); Object.assign(lease, data); return lease; },
    async count({ where }) { return leases.filter((item) => item.stationId === where.stationId && item.expiresAt > where.expiresAt.gt).length; },
    async create({ data }) { const lease = { id: `lease-${leases.length + 1}`, createdAt: instant, ...data }; leases.push(lease); return lease; }
  };
  return { leases, publicListenerLease: model, async $transaction(operation, options) { assert.equal(options.isolationLevel, "Serializable"); return operation({ publicListenerLease: model }); } };
}

test("public playback authority is anonymous, station-scoped, expiring and tamper evident", () => {
  const sessionHash = publicListenerSessionHash(firstSession, secret);
  const token = createPublicPlaybackToken({ organisationId: "org-1", stationId: "station-1", channelId: "channel-1", sessionHash, issuedAt: instant, expiresAt: new Date(instant.getTime() + 600_000) }, secret);
  const authority = verifyPublicPlaybackToken(token, { instant, secret });
  assert.equal(authority.stationId, "station-1");
  assert.equal(authority.channelId, "channel-1");
  assert.equal(authority.sessionHash, sessionHash);
  assert.doesNotMatch(token, new RegExp(firstSession));
  assert.equal(verifyPublicPlaybackToken(`${token}x`, { instant, secret }), null);
  assert.equal(verifyPublicPlaybackToken(token, { instant: new Date(instant.getTime() + 601_000), secret }), null);
  assert.equal(appendPublicPlaybackToken("/audio/1", token).startsWith("/audio/1?listener="), true);
});

test("public listener leases renew one session and enforce concurrent station capacity", async () => {
  const database = memoryDatabase();
  const radio = station(2);
  const first = await claimPublicListenerLease(database, { station: radio, channelId: "channel-1", sessionId: firstSession, instant, secret });
  assert.equal(first.ok, true);
  assert.deepEqual({ active: first.activeCount, limit: first.limit }, { active: 1, limit: 2 });
  const renewed = await claimPublicListenerLease(database, { station: radio, channelId: "channel-1", sessionId: firstSession, instant: new Date(instant.getTime() + 30_000), secret });
  assert.equal(renewed.ok, true);
  assert.equal(database.leases.length, 1);
  assert.equal((await claimPublicListenerLease(database, { station: radio, channelId: "channel-1", sessionId: "22222222-2222-4222-8222-222222222222", instant, secret })).ok, true);
  const denied = await claimPublicListenerLease(database, { station: radio, channelId: "channel-1", sessionId: "33333333-3333-4333-8333-333333333333", instant, secret });
  assert.equal(denied.status, 429);
  assert.equal(denied.code, "PUBLIC_LISTENER_LIMIT_REACHED");
});

test("disabled and unsubscribed public stations fail closed", async () => {
  const database = memoryDatabase();
  assert.equal((await claimPublicListenerLease(database, { station: { ...station(), publicPlayerEnabled: false }, channelId: "channel-1", sessionId: firstSession, instant, secret })).code, "PUBLIC_PLAYER_UNAVAILABLE");
  assert.equal((await claimPublicListenerLease(database, { station: { ...station(), organisation: { subscription: null } }, channelId: "channel-1", sessionId: firstSession, instant, secret })).status, 403);
  assert.equal(database.leases.length, 0);
});

test("public manifests use protected URLs and remove enrolled-player proof authority", () => {
  const player = { id: "public:station-1", name: "Public", zone: { name: "Web", location: { name: "Station", timezone: "Europe/Malta" }, channelAssignments: [{ channel: { id: "channel-1" } }] } };
  const track = { id: "track-1", title: "Song", artist: "Artist", status: "READY", mediaAsset: { id: "asset-1", durationSeconds: 180, status: "READY", mediaType: "MUSIC", libraryType: "RUVANAS_CATALOGUE", organisationId: null } };
  const manifest = buildPlayerManifest({ player, resolution: { reason: "DEFAULT_AUTODJ", musicMode: { id: "mode-1", name: "Main", slug: "main", tracks: [{ weight: 100, track }] } }, proofSecret: secret, listenerToken: "public-token", instant, includeProof: false, mediaUrlFor: (id, token) => `/api/public/player/station/media/${id}?listener=${token}` });
  assert.equal(manifest.playlist[0].mediaUrl, "/api/public/player/station/media/asset-1?listener=public-token");
  assert.equal("proofToken" in manifest.playlist[0], false);
  assert.equal("programmingSourceProofToken" in manifest.playlist[0], false);
  assert.deepEqual(publicNowPlaying(manifest, instant), { kind: "MUSIC", title: "Song", artist: "Artist", startedAt: manifest.live.current.startedAt });
});

test("public-player branding is bounded", () => {
  assert.deepEqual(normalizePublicPlayerSettings({ enabled: true, tagline: "  Malta live  ", accent: "#F4B942" }), { enabled: true, tagline: "Malta live", accent: "#f4b942", listenerRequestsEnabled: false, listenerRequestInstructions: null });
  assert.equal(normalizePublicPlayerSettings({ enabled: false, listenerRequestsEnabled: true }).listenerRequestsEnabled, false);
  assert.throws(() => normalizePublicPlayerSettings({ tagline: "x".repeat(161) }), /160/);
  assert.throws(() => normalizePublicPlayerSettings({ accent: "gold" }), /six-digit/);
});

test("Stage 19.14 keeps anonymous delivery separate from enrolled players and private source data", async () => {
  const [manifestRoute, mediaRoute, publicStationRoute, settingsRoute, page, migration, service] = await Promise.all([
    readFile(new URL("../app/api/public/player/[slug]/manifest/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/player/[slug]/media/[mediaAssetId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/stations/[slug]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/public-player/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PublicRadioPlayer.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261015000000_stage_19_14_public_player/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-player-service.js", import.meta.url), "utf8")
  ]);
  assert.match(manifestRoute, /PUBLIC_LISTENER_SESSION_HEADER/);
  assert.match(page, /X-Ruvanas-Listener-Session/i);
  assert.doesNotMatch(manifestRoute, /getClientAddress|user-agent/i);
  assert.match(mediaRoute, /authorizePublicPlayback/);
  assert.doesNotMatch(publicStationRoute, /streamUrl:/);
  assert.match(settingsRoute, /ORGANISATION_MANAGER_ROLES/);
  assert.match(page, /SESSION_STARTED/);
  assert.match(page, /HEARTBEAT/);
  assert.match(service, /persistOperationalEvidence: false/);
  assert.match(service, /createListenerTelemetryToken/);
  assert.match(migration, /PublicListenerLease_stationId_sessionHash_key/);
  assert.match(migration, /FOREIGN KEY \("channelId", "organisationId"\)/);
});

test("station-capacity checks remain bounded with a large active audience", async () => {
  const database = memoryDatabase();
  for (let index = 0; index < 5_000; index += 1) database.leases.push({ id: `lease-${index}`, stationId: "station-1", channelId: "channel-1", organisationId: "org-1", sessionHash: index.toString(16).padStart(64, "0"), expiresAt: new Date(instant.getTime() + 60_000), createdAt: instant });
  const denied = await claimPublicListenerLease(database, { station: station(5_000), channelId: "channel-1", sessionId: firstSession, instant, secret });
  assert.equal(denied.code, "PUBLIC_LISTENER_LIMIT_REACHED");
  assert.equal(database.leases.length, 5_000);
});
