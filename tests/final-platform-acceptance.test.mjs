import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeFinalAcceptanceEnvironment,
  finalAcceptanceSummary,
  FINAL_PLATFORM_ACCEPTANCE_STEPS
} from "../lib/final-platform-acceptance.mjs";

test("final acceptance is restricted to a local application and disposable database", () => {
  const safe = assertSafeFinalAcceptanceEnvironment({
    baseUrl: "http://127.0.0.1:3100",
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/ruvanas_acceptance",
    runDatabaseTests: "1"
  });
  assert.equal(safe.applicationOrigin, "http://127.0.0.1:3100");
  assert.equal(safe.databaseHost, "localhost");
  assert.equal(safe.stepCount, FINAL_PLATFORM_ACCEPTANCE_STEPS.length);

  assert.throws(() => assertSafeFinalAcceptanceEnvironment({
    baseUrl: "https://ruvanas-platform.onrender.com",
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/ruvanas_acceptance",
    runDatabaseTests: "1"
  }), /local application/);

  assert.throws(() => assertSafeFinalAcceptanceEnvironment({
    baseUrl: "http://127.0.0.1:3100",
    databaseUrl: "postgresql://production.example/ruvanas",
    runDatabaseTests: "1"
  }), /local disposable database/);

  assert.throws(() => assertSafeFinalAcceptanceEnvironment({
    baseUrl: "http://127.0.0.1:3100",
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/ruvanas_acceptance",
    runDatabaseTests: "0"
  }), /RUN_DATABASE_TESTS=1/);
});

test("final acceptance requires every integration, regression, and capacity step", () => {
  const passed = finalAcceptanceSummary(FINAL_PLATFORM_ACCEPTANCE_STEPS.map((step, index) => ({
    id: step.id,
    passed: true,
    durationMs: (index + 1) * 100
  })));
  assert.equal(passed.passed, true);
  assert.equal(passed.completed, FINAL_PLATFORM_ACCEPTANCE_STEPS.length);
  assert.deepEqual(passed.missing, []);

  const incomplete = finalAcceptanceSummary([{ id: FINAL_PLATFORM_ACCEPTANCE_STEPS[0].id, passed: true }]);
  assert.equal(incomplete.passed, false);
  assert.deepEqual(incomplete.missing, FINAL_PLATFORM_ACCEPTANCE_STEPS.slice(1).map((step) => step.id));
});
