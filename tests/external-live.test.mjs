import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  externalLiveAuthorizationHeaders,
  externalLiveAvailability,
  externalLiveCandidate,
  parseExternalLiveSourceInput,
  safeExternalLiveSource
} from "../lib/external-live.mjs";
import { probeStreamEndpoint } from "../lib/stream-source-health.mjs";

const now = new Date("2026-09-04T18:00:00.000Z");
const source = (overrides = {}) => ({
  id: "live-1",
  organisationId: "org-1",
  channelId: "channel-1",
  name: "Remote studio",
  providerKey: "ICECAST",
  streamUrl: "https://audio.example/live",
  credentialType: "NONE",
  credentialEncrypted: null,
  status: "ACTIVE",
  healthStatus: "HEALTHY",
  lastHealthCheckedAt: new Date(now.getTime() - 30_000),
  updatedAt: new Date(now.getTime() - 60_000),
  createdAt: new Date(now.getTime() - 120_000),
  consecutiveFailures: 0,
  ...overrides
});

test("external live input is bounded and requires protected credentials when selected", () => {
  const parsed = parseExternalLiveSourceInput({ name: " Remote studio ", channelId: "channel-1", providerKey: "icecast", streamUrl: "https://audio.example/live", credentialType: "basic", credentialUsername: "presenter", credentialSecret: "secret", startsAt: "2026-09-04T17:00:00.000Z", endsAt: "2026-09-04T19:00:00.000Z" });
  assert.equal(parsed.name, "Remote studio");
  assert.equal(parsed.providerKey, "ICECAST");
  assert.equal(parsed.credentialType, "BASIC");
  assert.throws(() => parseExternalLiveSourceInput({ name: "Studio", channelId: "one", streamUrl: "https://audio.example/live", credentialType: "BEARER" }), /credential/i);
  assert.throws(() => parseExternalLiveSourceInput({ name: "Studio", channelId: "one", streamUrl: "https://audio.example/live", startsAt: "2026-09-04T20:00:00.000Z", endsAt: "2026-09-04T19:00:00.000Z" }), /end after/i);
});

test("authorization headers are constructed only from decrypted server-side credentials", () => {
  assert.deepEqual(externalLiveAuthorizationHeaders(source()), {});
  assert.deepEqual(externalLiveAuthorizationHeaders(source({ credentialType: "BEARER", credentialEncrypted: "cipher" }), () => "token"), { Authorization: "Bearer token" });
  assert.deepEqual(externalLiveAuthorizationHeaders(source({ credentialType: "BASIC", credentialUsername: "dj", credentialEncrypted: "cipher" }), () => "password"), { Authorization: `Basic ${Buffer.from("dj:password").toString("base64")}` });
});

test("live availability fails closed for stale health, failed probes and expired windows", () => {
  assert.deepEqual(externalLiveAvailability(source(), now), { available: true, reason: null });
  assert.equal(externalLiveAvailability(source({ healthStatus: "DEGRADED" }), now).reason, "LIVE_SOURCE_DEGRADED");
  assert.equal(externalLiveAvailability(source({ lastHealthCheckedAt: new Date(now.getTime() - 151_000) }), now).reason, "LIVE_HEALTH_STALE");
  assert.equal(externalLiveAvailability(source({ endsAt: new Date(now.getTime() - 1) }), now).reason, "LIVE_WINDOW_ENDED");
});

test("healthy external live feeds the unified resolver without exposing its endpoint", () => {
  const candidate = externalLiveCandidate(source(), { organisationId: "org-1", channelId: "channel-1", instant: now });
  assert.equal(candidate.sourceType, "LIVE_SESSION");
  assert.equal(candidate.proofClassification, "LIVE");
  assert.equal(candidate.available, true);
  assert.deepEqual(candidate.payload.resolution.liveSource, { id: "live-1", providerKey: "ICECAST" });
  assert.equal(JSON.stringify(candidate).includes("audio.example"), false);
  const safe = safeExternalLiveSource(source({ channel: { id: "channel-1", name: "Main" } }));
  assert.equal(safe.endpointHost, "audio.example");
  assert.equal("streamUrl" in safe, false);
  assert.equal("credentialEncrypted" in safe, false);
});

test("protected probe headers reach the provider adapter", async () => {
  let received;
  const result = await probeStreamEndpoint("https://audio.example/live", {
    headers: { Authorization: "Bearer protected" },
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (_url, options) => { received = options.headers.Authorization; return new Response("", { status: 200, headers: { "content-type": "audio/mpeg" } }); }
  });
  assert.equal(result.status, "HEALTHY");
  assert.equal(received, "Bearer protected");
});

test("External Live routes remain tenant-bound, quota-bound and relay-only", async () => {
  const [api, action, relay, programming, manifest, worker, roadmap] = await Promise.all([
    readFile(new URL("../app/api/programming/external-live/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/external-live/[sourceId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/player/live/[sourceId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/player-programming.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/player-manifest.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/operations-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-online-radio-index.md", import.meta.url), "utf8")
  ]);
  assert.match(api, /membership\.organisationId/);
  assert.match(action, /OWNER.*MANAGER/);
  assert.match(relay, /isPlayerListenerTokenActive/);
  assert.match(relay, /playoutDecision\.sourceType !== "LIVE_SESSION"/);
  assert.match(relay, /validatePublicStreamEndpoint/);
  assert.match(programming, /externalLiveCandidate/);
  assert.match(manifest, /\/api\/player\/live\//);
  assert.doesNotMatch(manifest, /credentialEncrypted|streamUrl/);
  assert.match(worker, /scanExternalLiveHealth/);
  assert.match(roadmap, /19\.7 \| External Live \| DEPLOYED/);
});
