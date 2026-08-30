export const PERFORMANCE_TARGETS = Object.freeze({
  PUBLIC_PAGE: Object.freeze({ p95Ms: 1500, maxBytes: 1_500_000 }),
  AUTHENTICATED_READ: Object.freeze({ p95Ms: 500, maxBytes: 64_000 }),
  PLAYER_STATE: Object.freeze({ p95Ms: 300, maxBytes: 32_000 }),
  PLAYER_HEARTBEAT: Object.freeze({ p95Ms: 200, maxBytes: 32_000 })
});

function finiteSamples(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} needs at least one sample.`);
  const samples = values.map(Number);
  if (samples.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`${label} samples must be finite non-negative numbers.`);
  return samples;
}

export function percentile(values, percentileValue) {
  const samples = finiteSamples(values, "Percentile").sort((left, right) => left - right);
  const percentileNumber = Number(percentileValue);
  if (!Number.isFinite(percentileNumber) || percentileNumber <= 0 || percentileNumber > 100) throw new Error("Percentile must be greater than 0 and at most 100.");
  return samples[Math.max(0, Math.ceil((percentileNumber / 100) * samples.length) - 1)];
}

export function performanceSummary(durationsMs, responseBytes) {
  const durations = finiteSamples(durationsMs, "Duration");
  const bytes = finiteSamples(responseBytes, "Response size");
  if (durations.length !== bytes.length) throw new Error("Duration and response-size samples must have matching lengths.");
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    samples: durations.length,
    minMs: Math.round(Math.min(...durations)),
    meanMs: Math.round(total / durations.length),
    p50Ms: Math.round(percentile(durations, 50)),
    p95Ms: Math.round(percentile(durations, 95)),
    maxMs: Math.round(Math.max(...durations)),
    maxBytes: Math.max(...bytes)
  };
}

export function evaluatePerformanceBudget({ name, target, expectedStatus, statuses, durationsMs, responseBytes, attributable = true }) {
  const budget = PERFORMANCE_TARGETS[target];
  if (!budget) throw new Error(`Unknown performance target ${target}.`);
  const summary = performanceSummary(durationsMs, responseBytes);
  const findings = [];
  const unexpectedStatuses = [...new Set(statuses.filter((status) => status !== expectedStatus))];
  if (unexpectedStatuses.length) findings.push(`unexpected HTTP status: ${unexpectedStatuses.join(", ")}`);
  if (!attributable) findings.push("API response is missing a request identifier");
  if (summary.p95Ms > budget.p95Ms) findings.push(`p95 ${summary.p95Ms}ms exceeds ${budget.p95Ms}ms`);
  if (summary.maxBytes > budget.maxBytes) findings.push(`response ${summary.maxBytes} bytes exceeds ${budget.maxBytes} bytes`);
  return { name, target, expectedStatus, budget, summary, passed: findings.length === 0, findings };
}

export function extractModelBlock(schema, modelName) {
  const escaped = String(modelName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(schema).match(new RegExp(`model\\s+${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!match) throw new Error(`Prisma model ${modelName} is missing.`);
  return match[1].replace(/\s+/g, " ").trim();
}

export function modelHasDirective(schema, modelName, directive) {
  return extractModelBlock(schema, modelName).includes(String(directive).replace(/\s+/g, " ").trim());
}
