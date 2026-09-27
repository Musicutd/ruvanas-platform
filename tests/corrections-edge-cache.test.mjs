import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CorrectionsEdgeCache, edgeContentKey } from "../edge/cache.mjs";
import { signEdgeManifest } from "../lib/corrections-edge-manifest.mjs";

const pair = generateKeyPairSync("ed25519");
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" });
const scope = { nodeId: "cm12345678901234567890123", organisationId: "orgA", facilityId: "facilityA" };
const key = randomBytes(32);
const initial = new Date("2026-09-27T12:00:00.000Z");

function media(bytes, id) {
  return { mediaAssetId: id, promoVersionId: `version-${id}`, sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length, mimeType: "audio/wav", durationSeconds: 20, rightsUse: "CORRECTIONS_RADIO", sourceType: "PROGRAMME" };
}

function envelope(sequence, content, { now = initial, facilityId = scope.facilityId, hours = 24 } = {}) {
  const windows = content.map((item, index) => ({ id: `window-${index}`, facilityId, kind: "CENTRAL", mandatory: false,
    weekday: 0, startMinute: 0, endMinute: 1440, contentKey: edgeContentKey(item) }));
  return signEdgeManifest({ schema: 1, ...scope, facilityId, sequence, issuedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + hours * 60 * 60_000).toISOString(), zones: [], windows, overrides: [], content }, privatePem);
}

test("encrypted Edge cache activates atomically, reuses unchanged media, evicts withdrawn content and fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ruvanas-c8-cache-"));
  const one = Buffer.from("synthetic audio A");
  const two = Buffer.from("synthetic audio B");
  const a = media(one, "mediaA");
  const b = media(two, "mediaB");
  let now = new Date(initial);
  let downloads = 0;
  let online = true;
  const contents = new Map([[a.mediaAssetId, one], [b.mediaAssetId, two]]);
  const cache = new CorrectionsEdgeCache({ root, key, publicKeyPem, scope, now: () => now,
    fetchMedia: async (item) => { if (!online) throw new Error("cloud disconnected"); downloads += 1; return contents.get(item.mediaAssetId); } });
  try {
    await cache.initialise();
    assert.deepEqual(await cache.sync(envelope(1, [a])), { unchanged: false, downloaded: 1, reused: 0, sequence: 1 });
    assert.notEqual((await readFile(cache.objectPath(a))).includes(one), true, "encrypted cache must not contain plaintext");
    online = false;
    assert.deepEqual((await cache.readMedia(edgeContentKey(a))).bytes, one, "already approved content survives cloud loss");
    await assert.rejects(cache.sync(envelope(2, [a, b])), /cloud disconnected/);
    assert.equal(cache.active.payload.sequence, 1, "partial sync must not replace active authorisation");
    await assert.rejects(cache.readMedia(edgeContentKey(b)), /not authorised/);
    online = true;
    assert.deepEqual(await cache.sync(envelope(2, [a, b])), { unchanged: false, downloaded: 1, reused: 1, sequence: 2 });
    assert.equal(downloads, 2);
    assert.deepEqual(await cache.sync(envelope(2, [a, b])), { unchanged: true, downloaded: 0, reused: 2, sequence: 2 });
    await assert.rejects(cache.sync(envelope(3, [a], { facilityId: "facilityB" })), /rejected/);
    await assert.rejects(cache.sync({ ...envelope(3, [a]), payload: { ...envelope(3, [a]).payload, content: [] } }), /rejected/);
    assert.deepEqual(await cache.sync(envelope(3, [b])), { unchanged: false, downloaded: 0, reused: 1, sequence: 3 });
    await assert.rejects(cache.readMedia(edgeContentKey(a)), /not authorised/);
    assert.equal((await readdir(path.join(root, "objects"))).some((name) => name === path.basename(cache.objectPath(a))), false);
    now = new Date(initial.getTime() + 25 * 60 * 60_000);
    await assert.rejects(cache.readMedia(edgeContentKey(b)), /authorisation expired/);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    await rm(root, { recursive: true, force: true });
  }
});

test("a corrupt cache object is quarantined and produces no playback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ruvanas-c8-cache-"));
  const bytes = Buffer.from("synthetic private audio");
  const item = media(bytes, "mediaX");
  const cache = new CorrectionsEdgeCache({ root, key, publicKeyPem, scope, now: () => initial,
    fetchMedia: async () => bytes });
  try {
    await cache.initialise();
    await cache.sync(envelope(1, [item]));
    await writeFile(cache.objectPath(item), Buffer.from("corrupted"));
    await assert.rejects(cache.readMedia(edgeContentKey(item)), /unavailable/);
    assert.equal((await readdir(path.join(root, "quarantine"))).length, 1);
    assert.equal((await cache.sync(envelope(2, [item]))).downloaded, 1, "online repair re-fetches corrupt bytes");
    assert.deepEqual((await cache.readMedia(edgeContentKey(item))).bytes, bytes);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    await rm(root, { recursive: true, force: true });
  }
});
