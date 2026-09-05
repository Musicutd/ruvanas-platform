import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assessBrowserSoundcheck,
  assertBrowserStudioGrant,
  browserLiveProviderConfigured,
  browserStudioIsStale,
  browserStudioTransition,
  normalizeBrowserMixerState,
  parseBrowserStudioAction,
  parseBrowserStudioInput,
  safeBrowserStudioSession,
  validateProviderAllocation
} from "../lib/browser-live-studio.mjs";

const now = new Date("2026-09-05T10:00:00.000Z");
const grant = (overrides = {}) => ({ id: "grant-1", organisationId: "org-1", channelId: "channel-1", status: "ACTIVE", revokedAt: null, startsAt: new Date("2026-09-05T09:00:00.000Z"), endsAt: new Date("2026-09-05T12:00:00.000Z"), capabilities: ["VIEW_CHANNEL", "START_BROWSER_STUDIO", "RECORD_LIVE_SESSION"], ...overrides });
const session = (overrides = {}) => ({ id: "studio-1", organisationId: "org-1", product: "ONLINE_RADIO", channelId: "channel-1", djAccessGrantId: "grant-1", title: "Breakfast", status: "CREATED", connectionQuality: "UNKNOWN", scheduledStart: new Date("2026-09-05T10:15:00.000Z"), scheduledEnd: new Date("2026-09-05T12:00:00.000Z"), sessionVersion: 0, presenterJoinedAt: null, providerSessionRef: null, externalLiveSourceId: null, ...overrides });

test("Browser Studio scheduling is bounded and requires an assigned channel grant", () => {
  const parsed = parseBrowserStudioInput({ title: " Morning show ", channelId: "channel-1", djAccessGrantId: "grant-1", scheduledStart: "2026-09-05T10:15:00.000Z", scheduledEnd: "2026-09-05T12:00:00.000Z", recordEnabled: true, retentionApproved: true }, now);
  assert.equal(parsed.title, "Morning show");
  assert.equal(parsed.recordEnabled, true);
  assert.throws(() => parseBrowserStudioInput({ ...parsed, scheduledEnd: new Date("2026-09-05T17:00:00.000Z") }, now), /cannot exceed 6 hours/);
  assert.throws(() => parseBrowserStudioInput({ ...parsed, djAccessGrantId: "" }, now), /presenter/i);
});

test("the local mixer is bounded and soundcheck fails closed", () => {
  assert.deepEqual(normalizeBrowserMixerState({ microphoneGainDb: 99, bedGainDb: -99, duckingDb: 3 }), { microphoneGainDb: 12, bedGainDb: -60, duckingDb: 0, limiterEnabled: true, echoCancellation: true, noiseSuppression: true });
  const good = assessBrowserSoundcheck({ permissionGranted: true, microphoneDetected: true, peakDb: -12, sampleRate: 48_000, latencyMs: 80, mixer: {} });
  assert.equal(good.quality, "GOOD");
  assert.deepEqual(good.blockers, []);
  const failed = assessBrowserSoundcheck({ permissionGranted: false, microphoneDetected: false, peakDb: -60, sampleRate: 8_000, latencyMs: 2_000 });
  assert.equal(failed.quality, "FAILED");
  assert.ok(failed.blockers.includes("MICROPHONE_PERMISSION_REQUIRED"));
  assert.ok(failed.blockers.includes("LATENCY_UNACCEPTABLE"));
});

test("DJ access remains named, time-bound, channel-scoped and capability-scoped", () => {
  assert.equal(assertBrowserStudioGrant(grant(), { channelId: "channel-1", recordEnabled: true, now }), true);
  assert.throws(() => assertBrowserStudioGrant(grant(), { channelId: "channel-2", now }), /does not belong/);
  assert.throws(() => assertBrowserStudioGrant(grant({ capabilities: ["VIEW_CHANNEL"] }), { channelId: "channel-1", now }), /CAPABILITY_DENIED/);
  assert.throws(() => assertBrowserStudioGrant(grant({ capabilities: ["VIEW_CHANNEL", "START_BROWSER_STUDIO"] }), { channelId: "channel-1", recordEnabled: true, now }), /recording permission/);
});

test("studio state requires a good soundcheck and configured provider before ready", () => {
  const started = browserStudioTransition(session(), "START_SOUNDCHECK", { now });
  assert.equal(started.status, "SOUNDCHECK");
  const checked = browserStudioTransition(session({ status: "SOUNDCHECK" }), "SAVE_SOUNDCHECK", { now, soundcheck: { permissionGranted: true, microphoneDetected: true, peakDb: -10, sampleRate: 48_000, latencyMs: 100 } });
  assert.equal(checked.assessment.quality, "GOOD");
  assert.throws(() => browserStudioTransition(session({ status: "SOUNDCHECK", connectionQuality: "GOOD" }), "PREPARE", { now, providerConfigured: false }), /real-time media provider/);
  assert.equal(browserStudioTransition(session({ status: "SOUNDCHECK", connectionQuality: "GOOD" }), "PREPARE", { now, providerConfigured: true }).status, "READY");
  assert.throws(() => browserStudioTransition(session({ status: "SOUNDCHECK", connectionQuality: "DEGRADED" }), "PREPARE", { now, providerConfigured: true }), /good soundcheck/);
});

test("going live requires a provider allocation and remains inside the approved window", () => {
  const ready = session({ status: "READY", connectionQuality: "GOOD", providerSessionRef: "provider-1", externalLiveSourceId: "source-1" });
  const live = browserStudioTransition(ready, "GO_LIVE", { now });
  assert.equal(live.status, "ON_AIR");
  assert.equal(live.liveStartedAt, now);
  assert.throws(() => browserStudioTransition({ ...ready, providerSessionRef: null }, "GO_LIVE", { now }), /Prepare/);
  assert.throws(() => browserStudioTransition(ready, "GO_LIVE", { now: new Date("2026-09-05T12:00:00.000Z") }), /available from 30 minutes/);
});

test("fallback, end and heartbeat are explicit and stale studios fail closed", () => {
  assert.throws(() => browserStudioTransition(session({ status: "ON_AIR" }), "FORCE_FALLBACK", { now }), /reason/);
  const fallback = browserStudioTransition(session({ status: "ON_AIR" }), "FORCE_FALLBACK", { now, reason: "Presenter connection lost." });
  assert.equal(fallback.status, "FALLBACK");
  assert.equal(browserStudioTransition(session({ status: "ON_AIR" }), "HEARTBEAT", { now }).lastHeartbeatAt, now);
  assert.equal(browserStudioIsStale(session({ status: "ON_AIR", lastHeartbeatAt: new Date(now.getTime() - 46_000) }), now), true);
  assert.equal(browserStudioIsStale(session({ status: "ON_AIR", lastHeartbeatAt: new Date(now.getTime() - 44_000) }), now), false);
});

test("provider configuration and allocations require protected public HTTPS boundaries", () => {
  assert.equal(browserLiveProviderConfigured({ NODE_ENV: "production", BROWSER_LIVE_PROVIDER_API_URL: "https://media.example/api/", BROWSER_LIVE_PROVIDER_API_TOKEN: "secret" }), true);
  assert.equal(browserLiveProviderConfigured({ NODE_ENV: "production", BROWSER_LIVE_PROVIDER_API_URL: "http://media.example/api/", BROWSER_LIVE_PROVIDER_API_TOKEN: "secret" }), false);
  const providerResponse = { sessionRef: "provider-1", providerKey: "edge", whipEndpoint: "https://media.example/whip/1", publishToken: "short-lived", playbackUrl: "https://media.example/live/1.aac", expiresAt: "2099-09-05T12:00:00.000Z" };
  const allocation = validateProviderAllocation(providerResponse);
  assert.equal(allocation.providerKey, "edge");
  assert.throws(() => validateProviderAllocation({ ...providerResponse, whipEndpoint: "http://127.0.0.1/whip" }, { production: true }), /public HTTPS/);
});

test("safe responses omit publishing secrets, playback endpoints and tenant identifiers", () => {
  const safe = safeBrowserStudioSession(session({ providerSessionRef: "provider-1", providerPublishEncrypted: "secret-ciphertext", providerPlaybackUrl: "https://private.example/live", channel: { id: "channel-1", name: "Main" }, djAccessGrant: { label: "Host", granteeMembership: { user: { id: "user-1", name: "Presenter" } } }, createdAt: now, updatedAt: now }));
  const encoded = JSON.stringify(safe);
  assert.equal(safe.presenter.name, "Presenter");
  assert.equal(safe.providerReady, false);
  assert.equal(encoded.includes("secret-ciphertext"), false);
  assert.equal(encoded.includes("private.example"), false);
  assert.equal("organisationId" in safe, false);
});

test("actions reject unsupported transitions and retain optimistic concurrency input", () => {
  assert.deepEqual(parseBrowserStudioAction({ action: "heartbeat", sessionId: "studio-1", expectedVersion: 3, mixer: { microphoneGainDb: 2 } }), { action: "HEARTBEAT", sessionId: "studio-1", reason: null, soundcheck: null, mixer: { microphoneGainDb: 2, bedGainDb: -18, duckingDb: -12, limiterEnabled: true, echoCancellation: true, noiseSuppression: true }, expectedVersion: 3 });
  assert.throws(() => parseBrowserStudioAction({ action: "DELETE_ALL", sessionId: "studio-1" }), /supported/);
  assert.throws(() => browserStudioTransition(session(), "GO_LIVE", { now }), /Prepare/);
});

test("Stage 19.10 reuses the shared studio, DJ access, External Live and operations worker", async () => {
  const [schema, migration, managerRoute, presenterRoute, service, worker, managerUi, presenterUi, roadmap, documentation] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261011000000_stage_19_10_browser_live_studio/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/browser-live-studio/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dj-access/studio/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/browser-live-studio-service.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/operations-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/BrowserLiveStudioWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dj/studio/BrowserStudioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-online-radio-index.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-10-browser-live-studio.md", import.meta.url), "utf8")
  ]);
  assert.match(schema, /product\s+LiveStudioProduct/);
  assert.match(schema, /djAccessGrant\s+DjAccessGrant\?/);
  assert.match(migration, /one_open_online_session_per_channel/);
  assert.match(migration, /product_ownership_check/);
  assert.match(managerRoute, /OWNER.*MANAGER/);
  assert.match(presenterRoute, /requiredCapability: "START_BROWSER_STUDIO"/);
  assert.match(service, /activateExternalLiveSource/);
  assert.match(service, /providerPublishEncrypted/);
  assert.match(service, /status: "READY"/);
  assert.match(service, /assessment: _assessment/);
  assert.match(worker, /scanStaleBrowserStudioSessions/);
  assert.match(managerUi, /WHIP\/WebRTC/);
  assert.match(presenterUi, /RTCPeerConnection/);
  assert.match(presenterUi, /MediaStreamDestination/);
  assert.match(roadmap, /19\.10 \| Browser Live Studio \| DEPLOYED/);
  assert.match(documentation, /does not add a second identity, scheduler, stream or recording system/);
});
