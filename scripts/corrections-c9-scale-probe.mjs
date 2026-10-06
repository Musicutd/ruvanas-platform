import { correctionsScaleProbeOptions, runCorrectionsScaleProbe } from "../lib/corrections-c9-scale-probe.mjs";

const options = correctionsScaleProbeOptions({
  facilities: process.env.CORRECTIONS_PROBE_FACILITIES || 24,
  samples: process.env.CORRECTIONS_PROBE_SAMPLES || 10_000
});
const result = runCorrectionsScaleProbe(options);
process.stdout.write(JSON.stringify({ event: result.mismatchCount ? "corrections_policy_probe_failed" : "corrections_policy_probe_passed", ...result }) + "\n");
if (result.mismatchCount) process.exitCode = 1;
