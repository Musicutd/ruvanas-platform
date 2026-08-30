const LOCAL_ACCEPTANCE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const FINAL_PLATFORM_ACCEPTANCE_STEPS = Object.freeze([
  Object.freeze({
    id: "dual-vertical-integration",
    label: "Retail and School Radio integration journeys",
    command: "test:integration"
  }),
  Object.freeze({
    id: "release-regression",
    label: "Protected release regression smoke",
    command: "test:smoke"
  }),
  Object.freeze({
    id: "capacity-baseline",
    label: "Performance and capacity baseline",
    command: "test:performance"
  })
]);

function checkedUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
}

export function assertSafeFinalAcceptanceEnvironment({
  baseUrl,
  databaseUrl,
  runDatabaseTests
} = {}) {
  const application = checkedUrl(baseUrl, "INTEGRATION_BASE_URL");
  const database = checkedUrl(databaseUrl, "DATABASE_URL");

  if (!LOCAL_ACCEPTANCE_HOSTS.has(application.hostname)) {
    throw new Error("Final platform acceptance may run only against a local application instance.");
  }
  if (!LOCAL_ACCEPTANCE_HOSTS.has(database.hostname)) {
    throw new Error("Final platform acceptance may run only against a local disposable database.");
  }
  if (String(runDatabaseTests) !== "1") {
    throw new Error("RUN_DATABASE_TESTS=1 is required for final platform acceptance.");
  }

  return Object.freeze({
    applicationOrigin: application.origin,
    databaseHost: database.hostname,
    stepCount: FINAL_PLATFORM_ACCEPTANCE_STEPS.length
  });
}

export function finalAcceptanceSummary(results = []) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const steps = FINAL_PLATFORM_ACCEPTANCE_STEPS.map((step) => ({
    ...step,
    passed: byId.get(step.id)?.passed === true,
    durationMs: Math.max(0, Number(byId.get(step.id)?.durationMs) || 0)
  }));
  const missing = steps.filter((step) => !step.passed).map((step) => step.id);
  return Object.freeze({
    passed: missing.length === 0,
    completed: steps.length - missing.length,
    total: steps.length,
    missing,
    steps
  });
}
