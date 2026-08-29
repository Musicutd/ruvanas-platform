import test from "node:test";
import assert from "node:assert/strict";
import {
  integrationKindSupportsMetric,
  metricImportNotice,
  normalizeMetricBatch,
  normalizeMetricSummary
} from "../lib/integration-metrics.mjs";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const base = {
  externalId: "pos:store-4:2026-09-08T10",
  locationId: "cm00000000000000000000001",
  metricType: "POS_NET_SALES_MINOR",
  value: 125050,
  unit: "eur_minor",
  windowStartedAt: "2026-09-08T10:00:00.000Z",
  windowEndedAt: "2026-09-08T11:00:00.000Z",
  sourceTimestamp: "2026-09-08T11:05:00.000Z",
  dimensions: { department: "All retail", sourceLocationRef: "store-4" }
};

test("summary metrics are normalized without accepting customer-level dimensions", () => {
  const metric = normalizeMetricSummary(base, { connectionKind: "POS_METRICS", now: NOW });
  assert.equal(metric.unit, "EUR_MINOR");
  assert.equal(metric.value, "125050");
  assert.deepEqual(metric.dimensions, { department: "All retail", sourceLocationRef: "store-4" });
  assert.throws(() => normalizeMetricSummary({ ...base, dimensions: { customerEmail: "person@example.test" } }, { connectionKind: "POS_METRICS", now: NOW }), /not allowed/);
});

test("metric types are bound to their connection kind and unit", () => {
  assert.equal(integrationKindSupportsMetric("POS_METRICS", "POS_TRANSACTION_COUNT"), true);
  assert.equal(integrationKindSupportsMetric("FOOTFALL_METRICS", "POS_TRANSACTION_COUNT"), false);
  assert.throws(() => normalizeMetricSummary({ ...base, metricType: "FOOTFALL_ENTRIES", unit: "COUNT" }, { connectionKind: "POS_METRICS", now: NOW }), /not valid/);
  assert.throws(() => normalizeMetricSummary({ ...base, unit: "EUR" }, { connectionKind: "POS_METRICS", now: NOW }), /unit/);
});

test("count metrics reject negative, fractional and oversized windows", () => {
  const count = { ...base, metricType: "POS_TRANSACTION_COUNT", unit: "COUNT", value: 42 };
  assert.equal(normalizeMetricSummary(count, { connectionKind: "POS_METRICS", now: NOW }).value, "42");
  assert.throws(() => normalizeMetricSummary({ ...count, value: -1 }, { connectionKind: "POS_METRICS", now: NOW }), /negative/);
  assert.throws(() => normalizeMetricSummary({ ...count, value: 1.5 }, { connectionKind: "POS_METRICS", now: NOW }), /whole-number/);
  assert.throws(() => normalizeMetricSummary({ ...count, windowEndedAt: "2026-11-08T11:00:00.000Z" }, { connectionKind: "POS_METRICS", now: NOW }), /31 days/);
});

test("batch imports reject duplicate provider IDs before persistence", () => {
  assert.throws(() => normalizeMetricBatch([base, base], { connectionKind: "POS_METRICS", now: NOW }), /unique/);
  assert.equal(normalizeMetricBatch([base], { connectionKind: "POS_METRICS", now: NOW }).length, 1);
});

test("the product notice does not claim causation or audience measurement", () => {
  assert.match(metricImportNotice(), /do not prove/);
  assert.match(metricImportNotice(), /do not identify customers/);
});
