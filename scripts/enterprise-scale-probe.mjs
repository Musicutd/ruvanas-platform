import { performance } from "node:perf_hooks";
import { enterpriseProbeOptions, enterpriseProbeSummary } from "../lib/enterprise-scale-probe.mjs";

const options = enterpriseProbeOptions({
  baseUrl: process.env.ENTERPRISE_PROBE_BASE_URL || "http://127.0.0.1:3100",
  samples: Number(process.env.ENTERPRISE_PROBE_SAMPLES || 100),
  concurrency: Number(process.env.ENTERPRISE_PROBE_CONCURRENCY || 5)
});
const samples = [];
let next = 0;

async function worker() {
  while (next < options.samples) {
    next += 1;
    const startedAt = performance.now();
    const response = await fetch(`${options.baseUrl}/api/player/state`, { headers: { accept: "application/json", origin: options.baseUrl } });
    await response.arrayBuffer();
    samples.push({ durationMs: performance.now() - startedAt, status: response.status });
  }
}

await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
const summary = enterpriseProbeSummary(samples);
process.stdout.write(JSON.stringify({
  event: summary.errorRatePercent <= 1 && summary.p95BoundaryMs <= 500 ? "enterprise_scale_probe_passed" : "enterprise_scale_probe_failed",
  target: "local authenticated player boundary",
  concurrency: options.concurrency,
  ...summary
}) + "\n");
if (summary.errorRatePercent > 1 || summary.p95BoundaryMs > 500) process.exitCode = 1;
