import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  heartbeatBucketStart,
  incidentSeverityForOfflineDuration,
  incidentTransition,
  missedHeartbeatWindow,
  normalizeHeartbeatDiagnostics,
  playerHealthSummary
} from "../lib/player-health.mjs";
import {
  recordHeartbeatOperationalEvidence,
  scanPlayerHealth
} from "../lib/player-health-service.js";

test("heartbeat samples use stable five-minute buckets", () => {
  assert.equal(heartbeatBucketStart("2026-08-29T12:07:49.000Z").toISOString(), "2026-08-29T12:05:00.000Z");
  assert.equal(heartbeatBucketStart("2026-08-29T12:10:00.000Z").toISOString(), "2026-08-29T12:10:00.000Z");
});

test("heartbeat diagnostics retain only bounded operational fields", () => {
  assert.deepEqual(normalizeHeartbeatDiagnostics({ appVersion: " 1.4.2 ", manifestVersion: "rev-9", sourceStatus: "degraded", studentName: "must not be stored" }), {
    appVersion: "1.4.2",
    manifestVersion: "rev-9",
    sourceStatus: "DEGRADED"
  });
  assert.equal(normalizeHeartbeatDiagnostics({ sourceStatus: "invented" }).sourceStatus, null);
});

test("offline incidents begin only after the existing 90-second threshold", () => {
  const player = { status: "ONLINE", enrolledAt: new Date("2026-08-29T11:00:00.000Z"), lastHeartbeatAt: new Date("2026-08-29T11:58:30.000Z") };
  assert.equal(missedHeartbeatWindow(player, new Date("2026-08-29T12:00:00.000Z")), null);
  const window = missedHeartbeatWindow(player, new Date("2026-08-29T12:00:01.000Z"));
  assert.equal(window.firstObservedAt.toISOString(), "2026-08-29T12:00:00.000Z");
  assert.equal(window.severity, "LOW");
});

test("offline duration escalates severity predictably", () => {
  assert.equal(incidentSeverityForOfflineDuration(4 * 60_000), "LOW");
  assert.equal(incidentSeverityForOfflineDuration(5 * 60_000), "MEDIUM");
  assert.equal(incidentSeverityForOfflineDuration(15 * 60_000), "HIGH");
  assert.equal(incidentSeverityForOfflineDuration(60 * 60_000), "CRITICAL");
});

test("health incidents require audited notes for acknowledgement and resolution", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  assert.deepEqual(incidentTransition("OPEN", "ACKNOWLEDGE", "Support is checking the device.", now), {
    status: "ACKNOWLEDGED",
    acknowledgedAt: now,
    acknowledgementNote: "Support is checking the device."
  });
  assert.deepEqual(incidentTransition("ACKNOWLEDGED", "RESOLVE", "Player restarted and playback confirmed.", now), {
    status: "RESOLVED",
    resolvedAt: now,
    resolutionNote: "Player restarted and playback confirmed."
  });
  assert.throws(() => incidentTransition("ACKNOWLEDGED", "ACKNOWLEDGE", "Again"), /Only an open/);
  assert.throws(() => incidentTransition("OPEN", "RESOLVE", "x"), /short operational note/);
});

test("health summary separates current offline state from incident evidence", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  const players = [
    { status: "ONLINE", enrolledAt: now, lastHeartbeatAt: new Date("2026-08-29T11:59:45.000Z") },
    { status: "ONLINE", enrolledAt: now, lastHeartbeatAt: new Date("2026-08-29T11:50:00.000Z") }
  ];
  const incidents = [
    { status: "OPEN", severity: "CRITICAL" },
    { status: "RESOLVED", severity: "HIGH" }
  ];
  assert.deepEqual(playerHealthSummary(players, incidents, now), { totalPlayers: 2, offlinePlayers: 1, openIncidents: 1, criticalIncidents: 1 });
});

test(
  "database incident lifecycle opens, escalates, samples, and recovers",
  { skip: process.env.RUN_DATABASE_TESTS !== "1" },
  async () => {
    const { PrismaClient } = await import("@prisma/client");
    const database = new PrismaClient();
    const suffix = randomUUID();
    const firstScanAt = new Date("2026-08-29T12:00:00.000Z");

    try {
      const organisation = await database.organisation.create({
        data: { name: `Player health ${suffix}`, slug: `player-health-${suffix}` }
      });
      const location = await database.location.create({
        data: { organisationId: organisation.id, name: "Health test location", slug: "health-test-location", status: "ACTIVE" }
      });
      const zone = await database.zone.create({
        data: { locationId: location.id, name: "Health test zone", slug: "health-test-zone" }
      });
      const player = await database.player.create({
        data: {
          organisationId: organisation.id,
          zoneId: zone.id,
          name: "Health test player",
          status: "ONLINE",
          enrolledAt: new Date("2026-08-29T10:00:00.000Z"),
          lastHeartbeatAt: new Date("2026-08-29T11:50:00.000Z")
        },
        include: { zone: { include: { location: true } } }
      });

      assert.deepEqual(await scanPlayerHealth(database, { now: firstScanAt }), { scanned: 1, created: 1, updated: 0 });
      const opened = await database.playerHealthIncident.findFirstOrThrow({ where: { playerId: player.id } });
      assert.equal(opened.status, "OPEN");
      assert.equal(opened.severity, "MEDIUM");

      const escalationAt = new Date("2026-08-29T13:00:00.000Z");
      assert.deepEqual(await scanPlayerHealth(database, { now: escalationAt }), { scanned: 1, created: 0, updated: 1 });
      assert.equal((await database.playerHealthIncident.findUniqueOrThrow({ where: { id: opened.id } })).severity, "CRITICAL");

      const recoveryAt = new Date("2026-08-29T13:00:10.000Z");
      const recovery = await database.$transaction((tx) => recordHeartbeatOperationalEvidence(tx, {
        player,
        now: recoveryAt,
        diagnostics: { appVersion: "11a-test", sourceStatus: "connected", ignoredStudentDetail: "not retained" }
      }));
      assert.equal(recovery.recovered, true);
      const resolved = await database.playerHealthIncident.findUniqueOrThrow({ where: { id: opened.id } });
      assert.equal(resolved.status, "RESOLVED");
      assert.equal(resolved.resolvedAt.toISOString(), recoveryAt.toISOString());
      const sample = await database.playerHeartbeatSample.findFirstOrThrow({ where: { playerId: player.id } });
      assert.equal(sample.kind, "RECOVERY");
      assert.equal(sample.sourceStatus, "CONNECTED");
      assert.equal(sample.appVersion, "11a-test");
    } finally {
      await database.organisation.deleteMany({ where: { slug: `player-health-${suffix}` } });
      await database.$disconnect();
    }
  }
);

