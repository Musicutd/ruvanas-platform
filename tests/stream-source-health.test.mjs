import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  isPrivateNetworkAddress,
  normalizeStreamHealthSettings,
  probeStreamEndpoint,
  streamHealthBucketStart,
  streamIncidentSeverity,
  streamIncidentTransition,
  validatePublicStreamEndpoint
} from "../lib/stream-source-health.mjs";
import { probeStationStream } from "../lib/stream-source-health-service.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("stream health settings preserve supported providers and bounded probe controls", () => {
  assert.deepEqual(normalizeStreamHealthSettings({ providerKey: "generic_http", probeIntervalSeconds: 120, probeTimeoutMs: 5000, backupStreamUrl: " https://backup.example/live " }), {
    providerKey: "GENERIC_HTTP",
    backupStreamUrl: "https://backup.example/live",
    probeEnabled: true,
    probeIntervalSeconds: 120,
    probeTimeoutMs: 5000
  });
  assert.equal(normalizeStreamHealthSettings({ providerKey: "invented" }).providerKey, "CENTOVA_CAST");
  assert.throws(() => normalizeStreamHealthSettings({ probeIntervalSeconds: 5 }), /between 30 and 3600/);
  assert.throws(() => normalizeStreamHealthSettings({ probeTimeoutMs: 999 }), /between 1000 and 30000/);
});

test("stream probes reject local, private, credentialed, and private-DNS endpoints", async () => {
  assert.equal(isPrivateNetworkAddress("127.0.0.1"), true);
  assert.equal(isPrivateNetworkAddress("10.2.3.4"), true);
  assert.equal(isPrivateNetworkAddress("93.184.216.34"), false);
  await assert.rejects(validatePublicStreamEndpoint("http://localhost:8000/live"), /Local and private/);
  await assert.rejects(validatePublicStreamEndpoint("http://user:secret@example.com/live", { lookupImpl: publicLookup }), /without embedded credentials/);
  await assert.rejects(validatePublicStreamEndpoint("https://stream.example/live", { lookupImpl: async () => [{ address: "192.168.1.8", family: 4 }] }), /private or unavailable/);
});

test("stream probes classify healthy audio, unexpected content, redirects, and failures", async () => {
  let clock = 1_000;
  const now = () => { clock += 25; return clock; };
  const healthy = await probeStreamEndpoint("https://stream.example/live", {
    lookupImpl: publicLookup,
    now,
    fetchImpl: async () => new Response("", { status: 200, headers: { "content-type": "audio/mpeg" } })
  });
  assert.equal(healthy.status, "HEALTHY");
  assert.equal(healthy.httpStatus, 200);
  assert.equal(healthy.errorCode, null);

  const degraded = await probeStreamEndpoint("https://stream.example/live", {
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response("", { status: 200, headers: { "content-type": "text/html" } })
  });
  assert.equal(degraded.status, "DEGRADED");
  assert.equal(degraded.errorCode, "UNEXPECTED_CONTENT_TYPE");

  const redirected = await probeStreamEndpoint("https://stream.example/live", {
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://other.example/live" } })
  });
  assert.equal(redirected.status, "DEGRADED");
  assert.equal(redirected.errorCode, "REDIRECT_NOT_FOLLOWED");

  const failed = await probeStreamEndpoint("https://stream.example/live", {
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response("", { status: 503 })
  });
  assert.equal(failed.status, "UNREACHABLE");
  assert.equal(failed.errorCode, "HTTP_503");
});

test("samples, severity, and manual incident transitions are deterministic", () => {
  assert.equal(streamHealthBucketStart("2026-08-30T12:07:49.000Z").toISOString(), "2026-08-30T12:05:00.000Z");
  assert.equal(streamIncidentSeverity(2), "LOW");
  assert.equal(streamIncidentSeverity(3), "MEDIUM");
  assert.equal(streamIncidentSeverity(10), "HIGH");
  assert.equal(streamIncidentSeverity(30), "CRITICAL");
  const now = new Date("2026-08-30T12:00:00.000Z");
  assert.deepEqual(streamIncidentTransition("OPEN", "ACKNOWLEDGE", "Provider investigation opened.", now), {
    status: "ACKNOWLEDGED",
    acknowledgedAt: now,
    acknowledgementNote: "Provider investigation opened."
  });
  assert.throws(() => streamIncidentTransition("ACKNOWLEDGED", "ACKNOWLEDGE", "Again"), /Only an open/);
});

test("database stream probes open and recover source incidents without changing player state", { skip: process.env.RUN_DATABASE_TESTS !== "1" }, async () => {
  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  const suffix = randomUUID();
  try {
    const organisation = await database.organisation.create({ data: { name: `Stream health ${suffix}`, slug: `stream-health-${suffix}` } });
    const station = await database.station.create({ data: { organisationId: organisation.id, name: `Stream ${suffix}`, slug: `stream-${suffix}`, listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128 } });
    const config = await database.stationStreamConfig.create({
      data: { stationId: station.id, streamUrl: "https://stream.example/live", serverHost: "stream.example", serverPort: 443, providerKey: "GENERIC_HTTP" },
      include: { station: { select: { id: true, organisationId: true, name: true } } }
    });
    const failingFetch = async () => new Response("", { status: 503 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await probeStationStream(database, config, { now: new Date(Date.UTC(2026, 7, 30, 12, attempt * 5)), fetchImpl: failingFetch, lookupImpl: publicLookup });
      assert.equal(result.status, "UNREACHABLE");
    }
    const opened = await database.stationStreamHealthIncident.findFirstOrThrow({ where: { stationId: station.id } });
    assert.equal(opened.status, "OPEN");
    assert.equal(opened.severity, "MEDIUM");
    assert.equal(await database.notificationEvent.count({ where: { organisationId: organisation.id, type: "STREAM_ERROR", entityId: opened.id } }), 1);
    assert.equal(await database.job.count({ where: { organisationId: organisation.id, type: "NOTIFICATION_DELIVERY" } }), 1);
    assert.equal((await database.stationStreamConfig.findUniqueOrThrow({ where: { id: config.id } })).consecutiveFailures, 3);

    const recovered = await probeStationStream(database, config, {
      now: new Date("2026-08-30T12:20:00.000Z"),
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response("", { status: 200, headers: { "content-type": "audio/aac" } })
    });
    assert.equal(recovered.status, "HEALTHY");
    assert.equal((await database.stationStreamHealthIncident.findUniqueOrThrow({ where: { id: opened.id } })).status, "RESOLVED");
    const recoveredConfig = await database.stationStreamConfig.findUniqueOrThrow({ where: { id: config.id } });
    assert.equal(recoveredConfig.sourceConnectionStatus, "CONNECTED");
    assert.equal(recoveredConfig.consecutiveFailures, 0);
    assert.equal(await database.auditLog.count({ where: { action: "STATION_STREAM_INCIDENT_OPENED", entityId: opened.id } }), 1);
    assert.equal(await database.auditLog.count({ where: { action: "STATION_STREAM_INCIDENT_AUTO_RESOLVED", entityId: opened.id } }), 1);
  } finally {
    await database.organisation.deleteMany({ where: { slug: `stream-health-${suffix}` } });
    await database.$disconnect();
  }
});
