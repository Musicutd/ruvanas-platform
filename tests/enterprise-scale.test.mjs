import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ENTERPRISE_EVIDENCE_TYPES,
  ENTERPRISE_SCALE_ENVIRONMENT,
  enterpriseScaleReadiness,
  validateEnterpriseEvidence
} from "../lib/enterprise-scale.mjs";
import { enterpriseProbeOptions, enterpriseProbeSummary } from "../lib/enterprise-scale-probe.mjs";

const now = new Date("2026-09-06T12:00:00.000Z");
const inventory = { organisations: 10, stations: 20, channels: 30, players: 40, activeListenerSessions: 50, mediaAssets: 1_000 };

function evidenceEvent(evidenceType, metrics) {
  return {
    createdAt: now,
    actor: { name: "Scale operator", email: "operator@example.test" },
    details: { evidenceType, result: "PASS", reference: `report-${evidenceType}`, performedAt: "2026-09-05T12:00:00.000Z", metrics }
  };
}

const passingEvents = [
  evidenceEvent("TENANT_ISOLATION_REVIEW", { testedRoutes: 120, crossTenantLeaks: 0 }),
  evidenceEvent("CAPACITY_BASELINE", { testedStations: 100, testedConcurrentListeners: 1_000, sampleCount: 2_000, p95ManifestMs: 210, errorRatePercent: 0.2 }),
  evidenceEvent("SOAK_RUN", { durationHours: 25, sampleCount: 10_000, availabilityPercent: 99.95, errorRatePercent: 0.1, continuityGapSeconds: 5 }),
  evidenceEvent("FAILOVER_DRILL", { recoverySeconds: 90, continuityGapSeconds: 8 })
];

test("enterprise readiness needs every current passing gate on the paid service", () => {
  const report = enterpriseScaleReadiness({ environment: ENTERPRISE_SCALE_ENVIRONMENT, operational: { status: "HEALTHY" }, inventory, events: passingEvents, now });
  assert.equal(report.status, "READY_FOR_CONTROLLED_SCALE");
  assert.equal(report.evidence.every((item) => item.status === "CURRENT"), true);
  assert.deepEqual(report.evidence.map((item) => item.id), ENTERPRISE_EVIDENCE_TYPES.map((item) => item.id));
  assert.equal(report.capacity.every((item) => item.state === "WITHIN_GUARDRAIL"), true);
});

test("missing, failed, stale and undersized evidence fails closed", () => {
  const missing = enterpriseScaleReadiness({ environment: ENTERPRISE_SCALE_ENVIRONMENT, operational: { status: "HEALTHY" }, inventory, events: [], now });
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.evidence.every((item) => item.status === "INCOMPLETE"), true);

  assert.match(validateEnterpriseEvidence({ type: "SOAK_RUN", result: "PASS", performedAt: now, metrics: { durationHours: 4, sampleCount: 50, availabilityPercent: 99, errorRatePercent: 2, continuityGapSeconds: 60 } }, { now, inventory }).join(" "), /24 hours/);
  assert.match(validateEnterpriseEvidence({ type: "CAPACITY_BASELINE", result: "PASS", performedAt: now, metrics: { testedStations: 1, testedConcurrentListeners: 1, sampleCount: 100, p95ManifestMs: 100, errorRatePercent: 0 } }, { now, inventory }).join(" "), /station inventory/);
  assert.match(validateEnterpriseEvidence({ type: "FAILOVER_DRILL", result: "FAIL", performedAt: "2026-01-01", metrics: { recoverySeconds: 600, continuityGapSeconds: 60 } }, { now, inventory }).join(" "), /older than 90 days/);
});

test("wrong environment, critical health and reached capacity remain blockers", () => {
  const report = enterpriseScaleReadiness({
    environment: "ruvanas-platform-staging",
    operational: { status: "CRITICAL" },
    inventory: { ...inventory, players: 100_000 },
    events: passingEvents,
    now
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.findings.some((item) => item.code === "UNAPPROVED_ENVIRONMENT"));
  assert.ok(report.findings.some((item) => item.code === "PLATFORM_HEALTH_CRITICAL"));
  assert.ok(report.findings.some((item) => item.code === "CAPACITY_LIMIT_REACHED"));
});

test("the bounded probe is local-only and produces deterministic aggregate evidence", () => {
  assert.deepEqual(enterpriseProbeOptions({ baseUrl: "http://127.0.0.1:3100/path", samples: 100, concurrency: 5 }), { baseUrl: "http://127.0.0.1:3100", samples: 100, concurrency: 5 });
  assert.throws(() => enterpriseProbeOptions({ baseUrl: "https://ruvanas-platform.onrender.com", samples: 100, concurrency: 5 }), /only against a local/);
  assert.throws(() => enterpriseProbeOptions({ baseUrl: "http://localhost:3100", samples: 20, concurrency: 5 }), /between 100 and 10,000/);
  const summary = enterpriseProbeSummary(Array.from({ length: 100 }, (_, index) => ({ durationMs: index + 1, status: 401 })));
  assert.deepEqual(summary, { sampleCount: 100, p95BoundaryMs: 95, errorRatePercent: 0 });
});

test("enterprise control surface is super-admin-only, aggregate and non-mutating", async () => {
  const [route, service, page, client, navigation] = await Promise.all([
    readFile(new URL("../app/api/admin/enterprise-scale/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/enterprise-scale-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/enterprise-scale/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/enterprise-scale/EnterpriseScaleWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8")
  ]);
  assert.match(route, /requirePlatformAdmin/);
  assert.match(route, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(route, /auditLog\.create/);
  assert.doesNotMatch(route, /stationStreamConfig\.(update|upsert)/);
  assert.doesNotMatch(route, /playout.*\.(update|create)/i);
  assert.match(service, /organisation\.count/);
  assert.match(service, /station\.count/);
  assert.doesNotMatch(service, /organisation\.findMany/);
  assert.match(page, /never changes live playout/);
  assert.match(client, /Customer names, identities, content and listening histories are excluded/);
  assert.match(navigation, /\/admin\/enterprise-scale/);
});
