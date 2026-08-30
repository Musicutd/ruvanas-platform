import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  deploymentIdentity,
  heartbeatState,
  operationalReadiness,
  safeInstanceKey,
  safeOperationalErrorCode,
  structuredServiceLog
} from "../lib/operational-observability.mjs";
import { getOperationalHealth, recordServiceHeartbeat } from "../lib/operational-observability-service.js";

test("deployment identities and service logs expose only bounded operational metadata", () => {
  const identity = deploymentIdentity({
    service: "operations_worker",
    env: {
      RUVANAS_ENVIRONMENT: " paid-production\n",
      RUVANAS_RELEASE_VERSION: "release-12c",
      RENDER_GIT_COMMIT: "abcdef1234567890"
    },
    instanceId: "private-hostname-123",
    startedAt: "2026-08-30T10:00:00.000Z"
  });
  assert.equal(identity.environment, "paid-production");
  assert.equal(identity.version, "release-12c");
  assert.equal(identity.commitSha, "abcdef1234567890");
  assert.throws(() => deploymentIdentity({ service: "UNKNOWN" }), /supported operational service/);

  const log = JSON.parse(structuredServiceLog(identity, "error", "job_failed", {
    errorCode: "SAFE_FAILURE",
    service: "ATTACKER_OVERRIDE",
    instanceKey: "raw-instance"
  }));
  assert.equal(log.service, "OPERATIONS_WORKER");
  assert.equal(log.instanceKey, safeInstanceKey("private-hostname-123"));
  assert.equal(log.errorCode, "SAFE_FAILURE");
  assert.equal(JSON.stringify(log).includes("private-hostname-123"), false);
  assert.equal(safeOperationalErrorCode(Object.assign(new Error("password=must-not-leak"), { code: "provider timeout" })), "PROVIDER_TIMEOUT");
});

test("heartbeat state and readiness findings are deterministic", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  assert.equal(heartbeatState("2026-08-30T11:59:00.000Z", now), "CURRENT");
  assert.equal(heartbeatState("2026-08-30T11:55:00.000Z", now), "STALE");
  assert.equal(heartbeatState("not-a-date", now), "MISSING");
  assert.deepEqual(operationalReadiness(), { status: "HEALTHY", findings: [] });

  const warning = operationalReadiness({ mixedVersions: true, offlinePlayers: 2 });
  assert.equal(warning.status, "ATTENTION");
  assert.deepEqual(warning.findings.map((item) => item.code), ["MIXED_ACTIVE_RELEASES", "OFFLINE_PLAYERS"]);

  const critical = operationalReadiness({ missingServices: ["OPERATIONS_WORKER"], deadLetterJobs: 1 });
  assert.equal(critical.status, "CRITICAL");
  assert.equal(critical.findings.filter((item) => item.severity === "CRITICAL").length, 2);
});

test("database health report detects mixed releases without exposing instance identifiers", { skip: process.env.RUN_DATABASE_TESTS !== "1" }, async () => {
  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  const suffix = randomUUID();
  const environment = `stage-12c-${suffix}`;
  const now = new Date();
  const workerIdentity = deploymentIdentity({ service: "OPERATIONS_WORKER", env: { RUVANAS_ENVIRONMENT: environment, RUVANAS_RELEASE_VERSION: "release-old" }, instanceId: `private-worker-${suffix}`, startedAt: now });
  const webIdentity = deploymentIdentity({ service: "WEB", env: { RUVANAS_ENVIRONMENT: environment, RUVANAS_RELEASE_VERSION: "release-current" }, instanceId: `private-web-${suffix}`, startedAt: now });
  try {
    await recordServiceHeartbeat(database, { identity: workerIdentity, now, details: { queue: "jobs" } });
    const report = await getOperationalHealth(database, { now, env: { RUVANAS_ENVIRONMENT: environment }, webIdentity });
    assert.equal(report.deployment.environment, environment);
    assert.equal(report.deployment.mixedVersions, true);
    assert.deepEqual(report.deployment.missingServices, []);
    assert.ok(report.findings.some((item) => item.code === "MIXED_ACTIVE_RELEASES"));
    assert.ok(report.deployment.instances.some((item) => item.service === "OPERATIONS_WORKER"));
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(`private-worker-${suffix}`), false);
    assert.equal(serialized.includes(`private-web-${suffix}`), false);
    assert.equal(Object.hasOwn(report.deployment.instances[0], "instanceId"), false);
  } finally {
    await database.operationalServiceHeartbeat.deleteMany({ where: { environment } });
    await database.$disconnect();
  }
});
