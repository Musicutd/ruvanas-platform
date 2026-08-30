import { spawnSync } from "node:child_process";
import {
  assertSafeFinalAcceptanceEnvironment,
  finalAcceptanceSummary,
  FINAL_PLATFORM_ACCEPTANCE_STEPS
} from "../lib/final-platform-acceptance.mjs";

const environment = assertSafeFinalAcceptanceEnvironment({
  baseUrl: process.env.INTEGRATION_BASE_URL,
  databaseUrl: process.env.DATABASE_URL,
  runDatabaseTests: process.env.RUN_DATABASE_TESTS
});

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const results = [];

console.log(JSON.stringify({
  event: "final_platform_acceptance_started",
  applicationOrigin: environment.applicationOrigin,
  databaseHost: environment.databaseHost,
  stepCount: environment.stepCount
}));

for (const step of FINAL_PLATFORM_ACCEPTANCE_STEPS) {
  const startedAt = Date.now();
  console.log(JSON.stringify({ event: "acceptance_step_started", id: step.id, label: step.label }));
  const result = spawnSync(npmCommand, ["run", step.command], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  const durationMs = Date.now() - startedAt;
  const passed = result.status === 0;
  results.push({ id: step.id, passed, durationMs });
  console.log(JSON.stringify({ event: "acceptance_step_completed", id: step.id, passed, durationMs }));
  if (!passed) break;
}

const summary = finalAcceptanceSummary(results);
console.log(JSON.stringify({ event: "final_platform_acceptance_completed", ...summary }));
if (!summary.passed) process.exitCode = 1;
