import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePerformanceBudget, extractModelBlock, modelHasDirective, percentile, performanceSummary } from "../lib/performance-readiness.mjs";

test("percentiles use a deterministic nearest-rank calculation", () => {
  assert.equal(percentile([4, 1, 3, 2, 5], 50), 3);
  assert.equal(percentile([4, 1, 3, 2, 5], 95), 5);
  assert.throws(() => percentile([], 95), /at least one sample/);
});

test("performance summaries preserve p95 and maximum payload evidence", () => {
  assert.deepEqual(performanceSummary([10, 20, 30, 40, 50], [100, 120, 140, 160, 180]), {
    samples: 5, minMs: 10, meanMs: 30, p50Ms: 30, p95Ms: 50, maxMs: 50, maxBytes: 180
  });
});

test("budget evaluation rejects latency, payload, status, and attribution regressions", () => {
  const result = evaluatePerformanceBudget({
    name: "player", target: "PLAYER_STATE", expectedStatus: 200,
    statuses: [200, 503], durationsMs: [250, 350], responseBytes: [100, 40_000], attributable: false
  });
  assert.equal(result.passed, false);
  assert.equal(result.findings.length, 4);
});

test("Prisma performance directives are checked within the intended model", () => {
  const schema = `model Alpha {\n id String @id\n @@index([id])\n}\nmodel Beta {\n id String @id\n}\n`;
  assert.match(extractModelBlock(schema, "Alpha"), /@@index/);
  assert.equal(modelHasDirective(schema, "Alpha", "@@index([id])"), true);
  assert.equal(modelHasDirective(schema, "Beta", "@@index([id])"), false);
});
