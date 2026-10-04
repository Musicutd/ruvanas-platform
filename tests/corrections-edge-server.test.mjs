import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, webcrypto } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CorrectionsEdgeCache, edgeContentKey } from "../edge/cache.mjs";
import { createCorrectionsEdgeServer } from "../edge/server.mjs";
import { CorrectionsEdgeProofQueue } from "../edge/proof-queue.mjs";
import { signEdgeManifest } from "../lib/corrections-edge-manifest.mjs";
import { issueCorrectionsEdgePlayerGrant } from "../lib/corrections-edge-player-grant.mjs";
import { verifyCorrectionsEdgeAttestation } from "../lib/corrections-edge-attestation.mjs";

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
    zones: [{ id: "zoneA", channelId: "channelA", playerIds: ["playerA"] },
      { id: "zoneB", channelId: "channelB", playerIds: ["playerB"] }],
    windows: [{ id: "central", facilityId: scope.facilityId, kind: "CENTRAL", mandatory: false,
      distributionId: "d1", weekday: current.getUTCDay(), startMinute: 0, endMinute: 1440,
      contentKey: edgeContentKey(normalItem) }],
    overrides: override ? [{ id: "emergency-1", facilityId: scope.facilityId, type: "EMERGENCY",
      targetZoneIds: ["zoneA"], targetPlayerIds: ["playerA"], contentKey: edgeContentKey(emergencyItem),
      startedAt: new Date(current.getTime() - 5000).toISOString(),
      expiresAt: new Date(current.getTime() + 50_000).toISOString() }] : [],
    content: override ? [normalItem, emergencyItem] : [normalItem] }, privatePem);
  const proofQueue = new CorrectionsEdgeProofQueue({ root: path.join(root, "proof"), privateKeyPem: privatePem, scope });
  const browserOrigin = "http://127.0.0.1:3108";
  const edge = createCorrectionsEdgeServer({ cache, proofQueue, allowedPlayerOrigin: browserOrigin });
  try {
    await cache.initialise();
    await proofQueue.initialise();
    await cache.sync(make(1));
    const address = await edge.listen();
    const url = `http://127.0.0.1:${address.port}`;
    const nonce = randomUUID();
    const attestationResponse = await fetch(`${url}/v1/attest?nonce=${nonce}`, { headers: { origin: browserOrigin } });
    assert.equal(attestationResponse.status, 200);
    assert.equal(attestationResponse.headers.get("access-control-allow-origin"), browserOrigin);
    const attestation = await attestationResponse.json();
    assert.equal(await verifyCorrectionsEdgeAttestation(attestation,
      { ...scope, endpointOrigin: url, nonce, identityPublicKeyPem: publicKeyPem }, new Date(), webcrypto), true);
    assert.equal(await verifyCorrectionsEdgeAttestation(attestation,
      { ...scope, endpointOrigin: "https://other-edge.invalid", nonce, identityPublicKeyPem: publicKeyPem }, new Date(), webcrypto), false);
    assert.equal((await fetch(`${url}/v1/attest?nonce=${nonce}`, { headers: {
      origin: "https://unrelated.example.invalid" } })).status, 403);
    const grantFor = (extra = {}) => issueCorrectionsEdgePlayerGrant({ ...scope, zoneId: "zoneA", playerId: "playerA",
      manifestVersion: cache.active.version, ...extra }, privatePem,
    { now: current, validUntil: new Date(current.getTime() + 10 * 60_000) });
    const localSession = await fetch(`${url}/v1/session`, { method: "POST",
      headers: { origin: browserOrigin, "content-type": "application/json" },
      body: JSON.stringify({ grant: grantFor() }) });
    assert.equal(localSession.status, 200);
    const localLease = await localSession.json();
    assert.ok(localLease.accessToken);
    assert.ok(localLease.refreshToken);
    const sessionPlayback = await fetch(`${url}/v1/playback`, { headers: {
      origin: browserOrigin, authorization: `EdgeSession ${localLease.accessToken}` } });
    assert.equal(sessionPlayback.status, 200);
    const sessionState = await sessionPlayback.json();
    const guessablePath = `/v1/media/${createHash("sha256").update([
      scope.nodeId, "playerA", cache.active.version, edgeContentKey(normalItem)
    ].join(":")).digest("hex")}`;
    assert.notEqual(new URL(sessionState.mediaUrl, url).pathname, guessablePath,
      "local media paths must not be derivable from public content metadata");
    assert.equal((await fetch(`${url}${guessablePath}${new URL(sessionState.mediaUrl, url).search}`,
      { headers: { origin: browserOrigin } })).status, 404);
    assert.equal((await fetch(`${url}${sessionState.mediaUrl.split("&ticket=")[0]}&ticket=wrong`, {
      headers: { origin: browserOrigin } })).status, 403);
    const browserMedia = await fetch(`${url}${sessionState.mediaUrl}`, { headers: { origin: browserOrigin } });
    assert.equal(browserMedia.status, 200);
    assert.deepEqual(Buffer.from(await browserMedia.arrayBuffer()), normal);
    const zoneBGrant = grantFor({ zoneId: "zoneB", playerId: "playerB" });
    const zoneBSession = await fetch(`${url}/v1/session`, { method: "POST",
      headers: { origin: browserOrigin, "content-type": "application/json" },
      body: JSON.stringify({ grant: zoneBGrant }) });
    assert.equal(zoneBSession.status, 200);
    const zoneBLease = await zoneBSession.json();
    const zoneBState = await (await fetch(`${url}/v1/playback`, { headers: {
      origin: browserOrigin, authorization: `EdgeSession ${zoneBLease.accessToken}` } })).json();
    assert.equal(zoneBState.state, "READY");
    assert.notEqual(new URL(zoneBState.mediaUrl, url).pathname,
      new URL(sessionState.mediaUrl, url).pathname, "each zone/player needs a distinct protected media path");
    const forgedCrossZoneUrl = new URL(sessionState.mediaUrl, url);
    forgedCrossZoneUrl.searchParams.set("session", zoneBState.sessionId);
    forgedCrossZoneUrl.searchParams.set("ticket", new URL(zoneBState.mediaUrl, url).searchParams.get("ticket"));
    assert.equal((await fetch(forgedCrossZoneUrl, { headers: { origin: browserOrigin } })).status, 404,
      "a Zone B session cannot request Zone A's opaque media path");
    assert.equal((await fetch(`${url}/v1/proof`, { method: "POST", headers: {
      origin: browserOrigin, authorization: `EdgeSession ${zoneBLease.accessToken}`,
      "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionState.sessionId,
      eventType: "FAILED", positionSeconds: 0 }) })).status, 400);
    cache.suspended = true;
    assert.equal((await fetch(`${url}${sessionState.mediaUrl}`, { headers: {
      origin: browserOrigin } })).status, 401, "a suspended Edge cannot use an earlier browser media ticket");
    cache.suspended = false;
    const renewed = await fetch(`${url}/v1/renew`, { method: "POST", headers: {
      origin: browserOrigin, "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: localLease.refreshToken }) });
    assert.equal(renewed.status, 200);
    assert.ok((await renewed.json()).accessToken);
    let auth = { authorization: `Edge ${Buffer.from(JSON.stringify(grantFor())).toString("base64url")}` };
    assert.equal((await fetch(`${url}/v1/playback`)).status, 401);
    const playing = await fetch(`${url}/v1/playback`, { headers: auth });
    assert.equal(playing.status, 200);
    const normalState = await playing.json();
    assert.equal(normalState.source, "CORRECTIONS_CENTRAL");
    const audio = await fetch(`${url}${normalState.mediaUrl}`, { headers: auth });
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), normal);
    assert.equal(proofQueue.pendingCount, 1);
    assert.equal(proofQueue.pending()[0].payload.eventType, "STARTED");
    const range = await fetch(`${url}${normalState.mediaUrl}`, { headers: { ...auth, range: "bytes=0-6" } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), normal.subarray(0, 7));
    const impossibleComplete = await fetch(`${url}/v1/proof`, { method: "POST", headers: { ...auth,
      "content-type": "application/json" }, body: JSON.stringify({ sessionId: normalState.sessionId,
      eventType: "COMPLETED", positionSeconds: 20 }) });
    assert.equal(impossibleComplete.status, 400);
    const failure = await fetch(`${url}/v1/proof`, { method: "POST", headers: { ...auth,
      "content-type": "application/json" }, body: JSON.stringify({ sessionId: normalState.sessionId,
      eventType: "FAILED", positionSeconds: 0 }) });
    assert.equal(failure.status, 200);
    assert.equal(proofQueue.pendingCount, 2);
    assert.equal((await fetch(`${url}/v1/proof`, { method: "POST", headers: { ...auth,
      "content-type": "application/json" }, body: JSON.stringify({ sessionId: normalState.sessionId,
      eventType: "FAILED", positionSeconds: 0 }) })).status, 400);
    assert.equal((await fetch(`${url}/v1/media/${"0".repeat(64)}`, { headers: auth })).status, 401);
    const wrongGrant = grantFor({ zoneId: "zoneC", playerId: "playerC" });
    assert.equal((await fetch(`${url}/v1/playback`, { headers: {
      authorization: `Edge ${Buffer.from(JSON.stringify(wrongGrant)).toString("base64url")}` } })).status, 401);
    const otherFacility = grantFor({ facilityId: "facilityB" });
    assert.equal((await fetch(`${url}/v1/playback`, { headers: {
      authorization: `Edge ${Buffer.from(JSON.stringify(otherFacility)).toString("base64url")}` } })).status, 401);
    await cache.sync(make(2, true));
    auth = { authorization: `Edge ${Buffer.from(JSON.stringify(grantFor())).toString("base64url")}` };
    const interrupted = await (await fetch(`${url}/v1/playback`, { headers: auth })).json();
    assert.equal(interrupted.source, "CORRECTIONS_EMERGENCY");
    assert.equal((await fetch(`${url}${normalState.mediaUrl}`, { headers: auth })).status, 403);
    assert.deepEqual(Buffer.from(await (await fetch(`${url}${interrupted.mediaUrl}`, { headers: auth })).arrayBuffer()), emergency);
    await cache.sync(make(3));
    auth = { authorization: `Edge ${Buffer.from(JSON.stringify(grantFor())).toString("base64url")}` };
    const returned = await (await fetch(`${url}/v1/playback`, { headers: auth })).json();
    assert.equal(returned.source, "CORRECTIONS_CENTRAL");
  } finally {
    await new Promise((resolve) => edge.server.close(resolve));
    assert.equal(path.dirname(root), os.tmpdir());
    await rm(root, { recursive: true, force: true });
  }
});

test("same-audio source transitions require a new Edge session and cannot complete the old source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ruvanas-c8-source-"));
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" });
  const scope = { nodeId: "cm12345678901234567890123", organisationId: "orgA", facilityId: "facilityA" };
  const media = Buffer.from("one synthetic private audio item");
  const item = { mediaAssetId: "shared-audio", promoVersionId: "shared-version",
    sha256: createHash("sha256").update(media).digest("hex"), sizeBytes: media.length,
    durationSeconds: 6, mimeType: "audio/wav", rightsUse: "CORRECTIONS_RADIO",
    sourceType: "LICENSED_MUSIC", trackId: "track-one" };
  const contentKey = edgeContentKey(item);
  let clock = new Date("2026-10-04T10:00:58.000Z");
  const cache = new CorrectionsEdgeCache({ root, key: randomBytes(32), publicKeyPem, scope,
    now: () => clock, fetchMedia: async () => media });
  const window = (id, startMinute, endMinute) => ({ id, facilityId: scope.facilityId,
    kind: "CENTRAL", mandatory: false, distributionId: `distribution-${id}`,
    weekday: 0, startMinute, endMinute, contentKey });
  const insertion = (id, start, end) => ({ id, facilityId: scope.facilityId, zoneId: "zoneA",
    playerId: "playerA", trackId: item.trackId, contentKey, sourceRevision: `revision-${id}`,
    programmingSource: "CORRECTIONS_REQUEST", plannedStart: `2026-10-04T10:01:${start}.000Z`,
    expiresAt: `2026-10-04T10:01:${end}.000Z` });
  const override = (id, start, end) => ({ id, facilityId: scope.facilityId, type: "PRIORITY",
    targetZoneIds: ["zoneA"], targetPlayerIds: ["playerA"], contentKey,
    startedAt: `2026-10-04T10:01:${start}.000Z`, expiresAt: `2026-10-04T10:01:${end}.000Z` });
  const manifest = signEdgeManifest({ schema: 1, ...scope, sequence: 1,
    issuedAt: "2026-10-04T10:00:00.000Z", validUntil: "2026-10-04T11:00:00.000Z", timezone: "UTC",
    zones: [{ id: "zoneA", channelId: "channelA", playerIds: ["playerA"] }],
    windows: [window("window-a", 0, 601), window("window-b", 601, 1440)],
    insertions: [insertion("request-a", "10", "15"), insertion("request-b", "15", "20")],
    overrides: [override("priority-a", "25", "30"), override("priority-b", "30", "35")],
    content: [item] }, privatePem);
  const proofQueue = new CorrectionsEdgeProofQueue({ root: path.join(root, "proof"), privateKeyPem: privatePem, scope });
  const edge = createCorrectionsEdgeServer({ cache, proofQueue });
  try {
    await cache.initialise();
    await proofQueue.initialise();
    await cache.sync(manifest);
    const address = await edge.listen();
    const url = `http://127.0.0.1:${address.port}`;
    const grant = issueCorrectionsEdgePlayerGrant({ ...scope, zoneId: "zoneA", playerId: "playerA",
      manifestVersion: manifest.version }, privatePem,
    { now: clock, validUntil: new Date(clock.getTime() + 10 * 60_000) });
    const headers = { authorization: `Edge ${Buffer.from(JSON.stringify(grant)).toString("base64url")}` };
    const sourceFields = ({ windowId, insertionId, overrideId }) => ({
      windowId: windowId || null, insertionId: insertionId || null, overrideId: overrideId || null });
    const playback = async () => {
      const response = await fetch(`${url}/v1/playback`, { headers });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.state, "READY");
      const range = await fetch(`${url}${result.mediaUrl}`, { headers: { range: "bytes=0-3" } });
      assert.equal(range.status, 206, "uninterrupted media range requests remain valid");
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), media.subarray(0, 4));
      const started = proofQueue.pending().at(-1)?.payload;
      assert.equal(started?.eventType, "STARTED");
      assert.equal(started?.sessionId, result.sessionId);
      return { ...result, startedSource: sourceFields(started) };
    };
    const transition = async (before, instant, expectedSource) => {
      clock = new Date(instant);
      assert.equal((await fetch(`${url}${before.mediaUrl}`)).status, 403,
        "a media ticket must not survive an exact-source change");
      const completed = await fetch(`${url}/v1/proof`, { method: "POST", headers: {
        ...headers, "content-type": "application/json" }, body: JSON.stringify({
        sessionId: before.sessionId, eventType: "COMPLETED", positionSeconds: 6 }) });
      assert.equal(completed.status, 409, "the old source must not be claimed as completed");
      const interrupted = await fetch(`${url}/v1/proof`, { method: "POST", headers: {
        ...headers, "content-type": "application/json" }, body: JSON.stringify({
        sessionId: before.sessionId, eventType: "INTERRUPTED", positionSeconds: 2 }) });
      assert.equal(interrupted.status, 200, "the old source retains honest interruption evidence");
      const after = await playback();
      assert.notEqual(after.sessionId, before.sessionId, "the new source needs separate playback evidence");
      assert.equal(after.source, before.source, "this tests source identity, not changed media or source category");
      assert.deepEqual(after.startedSource, expectedSource, "new STARTED proof must name the exact new source");
      assert.notDeepEqual(after.startedSource, before.startedSource,
        "old and new proof must attribute different signed sources");
      return after;
    };
    const windowA = await playback();
    assert.equal(windowA.source, "CORRECTIONS_CENTRAL");
    assert.deepEqual(windowA.startedSource, { windowId: "window-a", insertionId: null, overrideId: null });
    await transition(windowA, "2026-10-04T10:01:02.000Z",
      { windowId: "window-b", insertionId: null, overrideId: null });
    clock = new Date("2026-10-04T10:01:11.000Z");
    const requestA = await playback();
    assert.equal(requestA.source, "CORRECTIONS_REQUEST");
    assert.deepEqual(requestA.startedSource, { windowId: null, insertionId: "request-a", overrideId: null });
    await transition(requestA, "2026-10-04T10:01:16.000Z",
      { windowId: null, insertionId: "request-b", overrideId: null });
    clock = new Date("2026-10-04T10:01:26.000Z");
    const priorityA = await playback();
    assert.equal(priorityA.source, "CORRECTIONS_PRIORITY");
    assert.deepEqual(priorityA.startedSource, { windowId: null, insertionId: null, overrideId: "priority-a" });
    await transition(priorityA, "2026-10-04T10:01:31.000Z",
      { windowId: null, insertionId: null, overrideId: "priority-b" });
  } finally {
    await new Promise((resolve) => edge.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
