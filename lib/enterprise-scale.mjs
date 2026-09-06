export const ENTERPRISE_SCALE_ENVIRONMENT = "ruvanas-platform";

export const ENTERPRISE_SCALE_LIMITS = Object.freeze([
  Object.freeze({ id: "organisations", label: "Organisations", warningAt: 8_000, hardLimit: 10_000 }),
  Object.freeze({ id: "stations", label: "Radio stations", warningAt: 20_000, hardLimit: 25_000 }),
  Object.freeze({ id: "channels", label: "Playout channels", warningAt: 40_000, hardLimit: 50_000 }),
  Object.freeze({ id: "players", label: "Enrolled players", warningAt: 80_000, hardLimit: 100_000 }),
  Object.freeze({ id: "activeListenerSessions", label: "Concurrent listener sessions", warningAt: 80_000, hardLimit: 100_000 }),
  Object.freeze({ id: "mediaAssets", label: "Managed media assets", warningAt: 4_000_000, hardLimit: 5_000_000 })
]);

export const ENTERPRISE_SCALE_SLOS = Object.freeze([
  Object.freeze({ id: "availabilityPercent", label: "Observed availability", operator: "atLeast", target: 99.9, unit: "%" }),
  Object.freeze({ id: "p95ManifestMs", label: "Manifest response p95", operator: "atMost", target: 500, unit: "ms" }),
  Object.freeze({ id: "errorRatePercent", label: "Request error rate", operator: "atMost", target: 1, unit: "%" }),
  Object.freeze({ id: "continuityGapSeconds", label: "Unplanned continuity gap", operator: "atMost", target: 30, unit: "seconds" }),
  Object.freeze({ id: "recoverySeconds", label: "Failover recovery time", operator: "atMost", target: 300, unit: "seconds" })
]);

export const ENTERPRISE_EVIDENCE_TYPES = Object.freeze([
  Object.freeze({ id: "TENANT_ISOLATION_REVIEW", label: "Tenant-isolation review", maxAgeDays: 90 }),
  Object.freeze({ id: "CAPACITY_BASELINE", label: "Representative capacity baseline", maxAgeDays: 30 }),
  Object.freeze({ id: "SOAK_RUN", label: "24-hour continuity soak", maxAgeDays: 30 }),
  Object.freeze({ id: "FAILOVER_DRILL", label: "Controlled failover drill", maxAgeDays: 90 })
]);

const evidenceById = new Map(ENTERPRISE_EVIDENCE_TYPES.map((item) => [item.id, item]));
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function finding(severity, code, message) {
  return Object.freeze({ severity, code, message });
}

export function validateEnterpriseEvidence({ type, result, performedAt, metrics = {} } = {}, { now = new Date(), inventory = {} } = {}) {
  const definition = evidenceById.get(type);
  if (!definition) return ["Unsupported evidence type."];
  const problems = [];
  const observedAt = new Date(performedAt);
  if (Number.isNaN(observedAt.getTime())) problems.push("Evidence time is invalid.");
  else {
    const ageMs = now.getTime() - observedAt.getTime();
    if (ageMs < -5 * 60_000) problems.push("Evidence time cannot be in the future.");
    if (ageMs > definition.maxAgeDays * 24 * 60 * 60_000) problems.push(`Evidence is older than ${definition.maxAgeDays} days.`);
  }
  if (result !== "PASS") problems.push("The latest evidence result is not PASS.");

  if (type === "TENANT_ISOLATION_REVIEW") {
    if ((finite(metrics.testedRoutes) || 0) < 1) problems.push("At least one tenant-scoped route must be tested.");
    if (finite(metrics.crossTenantLeaks) !== 0) problems.push("Cross-tenant leakage must be zero.");
  }
  if (type === "CAPACITY_BASELINE") {
    if ((finite(metrics.sampleCount) || 0) < 100) problems.push("Capacity evidence requires at least 100 samples.");
    if ((finite(metrics.testedStations) || 0) < Math.max(1, Number(inventory.stations) || 0)) problems.push("The capacity run did not cover the current station inventory.");
    if ((finite(metrics.testedConcurrentListeners) || 0) < Math.max(1, Number(inventory.activeListenerSessions) || 0)) problems.push("The capacity run did not cover current listener concurrency.");
    if ((finite(metrics.p95ManifestMs) ?? Infinity) > 500) problems.push("Manifest p95 exceeds 500 ms.");
    if ((finite(metrics.errorRatePercent) ?? Infinity) > 1) problems.push("Error rate exceeds 1%. ");
  }
  if (type === "SOAK_RUN") {
    if ((finite(metrics.durationHours) || 0) < 24) problems.push("The continuity soak must cover at least 24 hours.");
    if ((finite(metrics.sampleCount) || 0) < 100) problems.push("Soak evidence requires at least 100 samples.");
    if ((finite(metrics.availabilityPercent) || 0) < 99.9) problems.push("Observed availability is below 99.9%.");
    if ((finite(metrics.errorRatePercent) ?? Infinity) > 1) problems.push("Error rate exceeds 1%.");
    if ((finite(metrics.continuityGapSeconds) ?? Infinity) > 30) problems.push("An unplanned continuity gap exceeded 30 seconds.");
  }
  if (type === "FAILOVER_DRILL") {
    if ((finite(metrics.recoverySeconds) ?? Infinity) > 300) problems.push("Failover recovery exceeded five minutes.");
    if ((finite(metrics.continuityGapSeconds) ?? Infinity) > 30) problems.push("The failover continuity gap exceeded 30 seconds.");
  }
  return problems;
}

export function enterpriseScaleReadiness({ environment, operational, inventory = {}, events = [], now = new Date() } = {}) {
  const findings = [];
  if (environment !== ENTERPRISE_SCALE_ENVIRONMENT) findings.push(finding("CRITICAL", "UNAPPROVED_ENVIRONMENT", `Scale evidence must belong to the paid ${ENTERPRISE_SCALE_ENVIRONMENT} service.`));
  if (!operational) findings.push(finding("CRITICAL", "OPERATIONAL_EVIDENCE_UNAVAILABLE", "Current platform-health evidence is unavailable."));
  else if (operational.status === "CRITICAL") findings.push(finding("CRITICAL", "PLATFORM_HEALTH_CRITICAL", "Critical platform-health findings must be resolved."));
  else if (operational.status === "ATTENTION") findings.push(finding("WARNING", "PLATFORM_HEALTH_ATTENTION", "Current platform-health warnings require review."));

  const capacity = ENTERPRISE_SCALE_LIMITS.map((limit) => {
    const current = Math.max(0, Number(inventory[limit.id]) || 0);
    const state = current >= limit.hardLimit ? "BLOCKED" : current >= limit.warningAt ? "ATTENTION" : "WITHIN_GUARDRAIL";
    if (state === "BLOCKED") findings.push(finding("CRITICAL", "CAPACITY_LIMIT_REACHED", `${limit.label} reached its engineering guardrail.`));
    else if (state === "ATTENTION") findings.push(finding("WARNING", "CAPACITY_REVIEW_DUE", `${limit.label} is approaching its engineering guardrail.`));
    return Object.freeze({ ...limit, current, utilisationPercent: Math.round((current / limit.hardLimit) * 10_000) / 100, state });
  });

  const latest = new Map();
  for (const event of events) {
    const type = event?.details?.evidenceType;
    if (!evidenceById.has(type) || latest.has(type)) continue;
    latest.set(type, event);
  }
  const evidence = ENTERPRISE_EVIDENCE_TYPES.map((definition) => {
    const event = latest.get(definition.id);
    const problems = event ? validateEnterpriseEvidence({
      type: definition.id,
      result: event.details?.result,
      performedAt: event.details?.performedAt,
      metrics: event.details?.metrics
    }, { now, inventory }) : ["No evidence has been recorded."];
    if (problems.length) findings.push(finding("CRITICAL", `EVIDENCE_${definition.id}_INCOMPLETE`, `${definition.label}: ${problems[0]}`));
    return Object.freeze({
      ...definition,
      status: problems.length ? "INCOMPLETE" : "CURRENT",
      problems,
      reference: event?.details?.reference || null,
      performedAt: event?.details?.performedAt || null,
      recordedAt: event?.createdAt || null,
      recordedBy: event?.actor?.name || event?.actor?.email || null,
      metrics: event?.details?.metrics || null
    });
  });

  const status = findings.some((item) => item.severity === "CRITICAL")
    ? "BLOCKED"
    : findings.some((item) => item.severity === "WARNING")
      ? "ATTENTION"
      : "READY_FOR_CONTROLLED_SCALE";
  return Object.freeze({
    generatedAt: now,
    status,
    findings,
    environment,
    inventory: Object.freeze({ ...inventory }),
    capacity,
    slos: ENTERPRISE_SCALE_SLOS,
    evidence
  });
}
