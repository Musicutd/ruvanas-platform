import { performance } from "node:perf_hooks";
import { evaluatePerformanceBudget } from "../lib/performance-readiness.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const sampleCount = Math.max(5, Number(process.env.PERFORMANCE_SAMPLE_COUNT) || 8);
const warmupCount = 2;
const routes = [
  { name: "home", path: "/", target: "PUBLIC_PAGE", status: 200 },
  { name: "login", path: "/login", target: "PUBLIC_PAGE", status: 200 },
  { name: "player-enrolment-page", path: "/player", target: "PUBLIC_PAGE", status: 200 },
  { name: "player-state-auth-boundary", path: "/api/player/state", target: "PLAYER_STATE", status: 401, api: true },
  { name: "player-heartbeat-auth-boundary", path: "/api/player/heartbeat", target: "PLAYER_HEARTBEAT", status: 401, api: true, method: "POST", body: "{}" },
  { name: "notification-auth-boundary", path: "/api/notifications", target: "AUTHENTICATED_READ", status: 401, api: true },
  { name: "operations-auth-boundary", path: "/api/admin/operations/health", target: "AUTHENTICATED_READ", status: 401, api: true }
];

async function sampleRoute(route) {
  const durationsMs = [];
  const responseBytes = [];
  const statuses = [];
  let attributable = true;
  for (let attempt = 0; attempt < warmupCount + sampleCount; attempt += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}${route.path}`, {
      method: route.method || "GET",
      body: route.body,
      redirect: "manual",
      headers: route.api ? { accept: "application/json", origin: baseUrl, ...(route.body ? { "content-type": "application/json" } : {}) } : undefined
    });
    const body = await response.arrayBuffer();
    const elapsed = performance.now() - startedAt;
    if (attempt >= warmupCount) {
      durationsMs.push(elapsed);
      responseBytes.push(body.byteLength);
      statuses.push(response.status);
      if (route.api && !response.headers.get("x-request-id")) attributable = false;
    }
  }
  return evaluatePerformanceBudget({ name: route.name, target: route.target, expectedStatus: route.status, statuses, durationsMs, responseBytes, attributable });
}

const results = [];
for (const route of routes) results.push(await sampleRoute(route));
const failures = results.filter((result) => !result.passed);
process.stdout.write(JSON.stringify({ event: failures.length ? "performance_baseline_failed" : "performance_baseline_passed", baseUrl, results }) + "\n");
if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure.name}: ${failure.findings.join("; ")}\n`);
  process.exitCode = 1;
}
