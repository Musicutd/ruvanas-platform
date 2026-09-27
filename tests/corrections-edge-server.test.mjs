import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CorrectionsEdgeCache, edgeContentKey } from "../edge/cache.mjs";
import { createCorrectionsEdgeServer } from "../edge/server.mjs";
import { signEdgeManifest } from "../lib/corrections-edge-manifest.mjs";
import { issueCorrectionsEdgePlayerGrant } from "../lib/corrections-edge-player-grant.mjs";

test("authenticated local player sees only its current private media; C6 overrides and return follow signed sync", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ruvanas-c8-server-"));
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" });
  const scope = { nodeId: "cm12345678901234567890123", organisationId: "orgA", facilityId: "facilityA" };
  const current = new Date();
  const normal = Buffer.from("private normal synthetic audio");
  const emergency = Buffer.from("private emergency synthetic audio");
  const item = (id, bytes) => ({ mediaAssetId: id, promoVersionId: `v-${id}`,
    sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length,
    durationSeconds: 20, mimeType: "audio/wav", rightsUse: "CORRECTIONS_RADIO", sourceType: "PROGRAMME" });
  const normalItem = item("normal", normal);
  const emergencyItem = item("emergency", emergency);
  const objects = new Map([["normal", normal], ["emergency", emergency]]);
  const cache = new CorrectionsEdgeCache({ root, key: randomBytes(32), publicKeyPem, scope,
    fetchMedia: async (entry) => objects.get(entry.mediaAssetId) });
  const make = (sequence, override = false) => signEdgeManifest({ schema: 1, ...scope, sequence,
    issuedAt: new Date(current.getTime() - 5000).toISOString(),
    validUntil: new Date(current.getTime() + 60 * 60_000).toISOString(), timezone: "UTC",
    zones: [{ id: "zoneA", channelId: "channelA", playerIds: ["playerA"] }],
    windows: [{ id: "central", facilityId: scope.facilityId, kind: "CENTRAL", mandatory: false,
      distributionId: "d1", weekday: current.getUTCDay(), startMinute: 0, endMinute: 1440,
      contentKey: edgeContentKey(normalItem) }],
    overrides: override ? [{ id: "emergency-1", facilityId: scope.facilityId, type: "EMERGENCY",
      targetZoneIds: ["zoneA"], targetPlayerIds: ["playerA"], contentKey: edgeContentKey(emergencyItem),
      startedAt: new Date(current.getTime() - 5000).toISOString(),
      expiresAt: new Date(current.getTime() + 50_000).toISOString() }] : [],
    content: override ? [normalItem, emergencyItem] : [normalItem] }, privatePem);
  const edge = createCorrectionsEdgeServer({ cache });
  try {
    await cache.initialise();
    await cache.sync(make(1));
    const address = await edge.listen();
    const url = `http://127.0.0.1:${address.port}`;
    const grant = issueCorrectionsEdgePlayerGrant({ ...scope, zoneId: "zoneA", playerId: "playerA" }, privatePem,
      { now: current, validUntil: new Date(current.getTime() + 60 * 60_000) });
    const auth = { authorization: `Edge ${Buffer.from(JSON.stringify(grant)).toString("base64url")}` };
    assert.equal((await fetch(`${url}/v1/playback`)).status, 401);
    const playing = await fetch(`${url}/v1/playback`, { headers: auth });
    assert.equal(playing.status, 200);
    const normalState = await playing.json();
    assert.equal(normalState.source, "CORRECTIONS_CENTRAL");
    const audio = await fetch(`${url}${normalState.mediaUrl}`, { headers: auth });
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), normal);
    const range = await fetch(`${url}${normalState.mediaUrl}`, { headers: { ...auth, range: "bytes=0-6" } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), normal.subarray(0, 7));
    assert.equal((await fetch(`${url}/v1/media/${"0".repeat(64)}`, { headers: auth })).status, 404);
    const wrongGrant = issueCorrectionsEdgePlayerGrant({ ...scope, zoneId: "zoneB", playerId: "playerB" }, privatePem,
      { now: current, validUntil: new Date(current.getTime() + 60 * 60_000) });
    assert.equal((await fetch(`${url}/v1/playback`, { headers: {
      authorization: `Edge ${Buffer.from(JSON.stringify(wrongGrant)).toString("base64url")}` } })).status, 401);
    const otherFacility = issueCorrectionsEdgePlayerGrant({ ...scope, facilityId: "facilityB", zoneId: "zoneA", playerId: "playerA" }, privatePem,
      { now: current, validUntil: new Date(current.getTime() + 60 * 60_000) });
    assert.equal((await fetch(`${url}/v1/playback`, { headers: {
      authorization: `Edge ${Buffer.from(JSON.stringify(otherFacility)).toString("base64url")}` } })).status, 401);
    await cache.sync(make(2, true));
    const interrupted = await (await fetch(`${url}/v1/playback`, { headers: auth })).json();
    assert.equal(interrupted.source, "CORRECTIONS_EMERGENCY");
    assert.equal((await fetch(`${url}${normalState.mediaUrl}`, { headers: auth })).status, 404);
    assert.deepEqual(Buffer.from(await (await fetch(`${url}${interrupted.mediaUrl}`, { headers: auth })).arrayBuffer()), emergency);
    await cache.sync(make(3));
    const returned = await (await fetch(`${url}/v1/playback`, { headers: auth })).json();
    assert.equal(returned.source, "CORRECTIONS_CENTRAL");
  } finally {
    await new Promise((resolve) => edge.server.close(resolve));
    assert.equal(path.dirname(root), os.tmpdir());
    await rm(root, { recursive: true, force: true });
  }
});
