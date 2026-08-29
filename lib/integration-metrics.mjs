export const METRIC_CONNECTION_KINDS = Object.freeze([
  "POS_METRICS",
  "INVENTORY_METRICS",
  "FOOTFALL_METRICS"
]);

export const INTEGRATION_METRIC_TYPES = Object.freeze([
  "POS_NET_SALES_MINOR",
  "POS_TRANSACTION_COUNT",
  "INVENTORY_UNITS_ON_HAND",
  "INVENTORY_STOCKOUT_COUNT",
  "FOOTFALL_ENTRIES",
  "FOOTFALL_EXITS"
]);

const METRIC_RULES = Object.freeze({
  POS_NET_SALES_MINOR: { connectionKind: "POS_METRICS", unitPattern: /^[A-Z]{3}_MINOR$/, integer: true, allowNegative: true },
  POS_TRANSACTION_COUNT: { connectionKind: "POS_METRICS", unit: "COUNT", integer: true, allowNegative: false },
  INVENTORY_UNITS_ON_HAND: { connectionKind: "INVENTORY_METRICS", unit: "UNITS", integer: false, allowNegative: false },
  INVENTORY_STOCKOUT_COUNT: { connectionKind: "INVENTORY_METRICS", unit: "COUNT", integer: true, allowNegative: false },
  FOOTFALL_ENTRIES: { connectionKind: "FOOTFALL_METRICS", unit: "COUNT", integer: true, allowNegative: false },
  FOOTFALL_EXITS: { connectionKind: "FOOTFALL_METRICS", unit: "COUNT", integer: true, allowNegative: false }
});

const SAFE_DIMENSION_KEYS = Object.freeze([
  "category",
  "department",
  "sourceLocationRef",
  "stockClass"
]);

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export function integrationKindSupportsMetric(connectionKind, metricType) {
  return METRIC_RULES[metricType]?.connectionKind === connectionKind;
}

export function normalizeMetricDimensions(dimensions) {
  if (dimensions == null) return null;
  if (typeof dimensions !== "object" || Array.isArray(dimensions)) {
    throw new Error("Metric dimensions must be a simple object.");
  }

  const result = {};
  for (const [key, rawValue] of Object.entries(dimensions)) {
    if (!SAFE_DIMENSION_KEYS.includes(key)) {
      throw new Error(`Metric dimension ${key} is not allowed.`);
    }
    const value = String(rawValue ?? "").trim();
    if (!value || value.length > 100) {
      throw new Error(`Metric dimension ${key} must be between 1 and 100 characters.`);
    }
    result[key] = value;
  }

  return Object.keys(result).length ? result : null;
}

export function normalizeMetricSummary(input, { connectionKind, now = new Date() }) {
  const rule = METRIC_RULES[input.metricType];
  if (!rule || rule.connectionKind !== connectionKind) {
    throw new Error("The metric type is not valid for this integration connection.");
  }

  const value = Number(input.value);
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) {
    throw new Error("Metric values must be finite and within the supported range.");
  }
  if (rule.integer && !Number.isSafeInteger(value)) {
    throw new Error("This metric requires a whole-number value.");
  }
  if (!rule.allowNegative && value < 0) {
    throw new Error("This metric cannot be negative.");
  }

  const unit = String(input.unit || "").trim().toUpperCase();
  if ((rule.unit && unit !== rule.unit) || (rule.unitPattern && !rule.unitPattern.test(unit))) {
    throw new Error("The metric unit does not match the selected metric type.");
  }

  const windowStartedAt = new Date(input.windowStartedAt);
  const windowEndedAt = new Date(input.windowEndedAt);
  const sourceTimestamp = new Date(input.sourceTimestamp);
  if ([windowStartedAt, windowEndedAt, sourceTimestamp].some((date) => Number.isNaN(date.getTime()))) {
    throw new Error("Metric timestamps must be valid ISO-8601 values.");
  }
  if (windowEndedAt <= windowStartedAt || windowEndedAt - windowStartedAt > MAX_WINDOW_MS) {
    throw new Error("Metric windows must be positive and no longer than 31 days.");
  }
  if (sourceTimestamp.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new Error("The source timestamp is too far in the future.");
  }

  const externalId = String(input.externalId || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(externalId)) {
    throw new Error("External metric IDs may contain letters, numbers, dots, underscores, colons and hyphens.");
  }

  return {
    externalId,
    locationId: input.locationId,
    metricType: input.metricType,
    value: String(value),
    unit,
    windowStartedAt,
    windowEndedAt,
    sourceTimestamp,
    dimensions: normalizeMetricDimensions(input.dimensions)
  };
}

export function normalizeMetricBatch(items, context) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 500) {
    throw new Error("Submit between 1 and 500 summarized metrics per request.");
  }

  const normalized = items.map((item) => normalizeMetricSummary(item, context));
  const ids = new Set();
  for (const item of normalized) {
    if (ids.has(item.externalId)) throw new Error("External metric IDs must be unique within a request.");
    ids.add(item.externalId);
  }
  return normalized;
}

export function metricImportNotice() {
  return "Imported summaries are operational correlation data. They do not identify customers and do not prove that audio caused sales, stock movement or footfall.";
}
