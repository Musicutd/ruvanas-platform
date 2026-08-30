import assert from "node:assert/strict";
import test from "node:test";
import { LAUNCH_OPERATOR_CHECKS, launchReadiness, PAID_RUVANAS_SERVICE } from "../lib/launch-readiness.mjs";

function operational(overrides = {}) {
  return {
    status: "HEALTHY",
    deployment: {
      environment: PAID_RUVANAS_SERVICE,
      mixedVersions: false,
      activeVersions: ["release-14b"],
      missingServices: [],
      instances: [{ service: "WEB", state: "CURRENT", commitSha: "abcdef1234567890" }]
    },
    ...overrides
  };
}

test("launch readiness requires the paid service, attributable release, and current services", () => {
  const ready = launchReadiness({ operational: operational(), recovery: { status: "READY" } });
  assert.equal(ready.status, "READY_FOR_OPERATOR_SIGN_OFF");
  assert.equal(ready.deployment.environment, PAID_RUVANAS_SERVICE);
  assert.equal(ready.deployment.commitSha, "abcdef1234567890");
  assert.equal(ready.operatorChecks.length, LAUNCH_OPERATOR_CHECKS.length);

  const wrongEnvironment = launchReadiness({
    operational: operational({ deployment: { ...operational().deployment, environment: "ruvanas-platform-staging" } }),
    recovery: { status: "READY" }
  });
  assert.equal(wrongEnvironment.status, "BLOCKED");
  assert.ok(wrongEnvironment.findings.some((item) => item.code === "UNAPPROVED_DEPLOYMENT_ENVIRONMENT"));
});

test("mixed releases, missing services, and absent commit evidence block handover", () => {
  const report = launchReadiness({
    operational: operational({
      deployment: {
        environment: PAID_RUVANAS_SERVICE,
        mixedVersions: true,
        activeVersions: ["old", "new"],
        missingServices: ["OPERATIONS_WORKER"],
        instances: [{ service: "WEB", state: "CURRENT", commitSha: null }]
      }
    }),
    recovery: { status: "READY" }
  });
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.findings.map((item) => item.code), [
    "DEPLOYMENT_COMMIT_UNAVAILABLE",
    "MIXED_ACTIVE_RELEASES",
    "EXPECTED_SERVICE_MISSING"
  ]);
});

test("operational and recovery warnings require attention while critical evidence blocks", () => {
  const attention = launchReadiness({
    operational: operational({ status: "ATTENTION" }),
    recovery: { status: "ATTENTION" }
  });
  assert.equal(attention.status, "ATTENTION");
  assert.deepEqual(attention.findings.map((item) => item.code), ["PLATFORM_HEALTH_ATTENTION", "RECOVERY_ATTENTION"]);

  const blocked = launchReadiness({ operational: operational({ status: "CRITICAL" }), recovery: { status: "NOT_READY" } });
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.findings.some((item) => item.code === "PLATFORM_HEALTH_CRITICAL"));
  assert.ok(blocked.findings.some((item) => item.code === "RECOVERY_NOT_READY"));
});

test("operator confirmations never claim automatic approval", () => {
  assert.deepEqual(LAUNCH_OPERATOR_CHECKS.map((item) => item.id), [
    "CI_ACCEPTANCE_PASSED",
    "PAID_DEPLOYMENT_LIVE",
    "PUBLIC_SMOKE_PASSED",
    "FREE_STAGING_SUSPENDED",
    "BUSINESS_LAUNCH_APPROVED"
  ]);
  assert.equal(LAUNCH_OPERATOR_CHECKS.some((item) => Object.hasOwn(item, "passed")), false);
});
