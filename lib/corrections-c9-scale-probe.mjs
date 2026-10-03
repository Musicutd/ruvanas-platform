import { performance } from "node:perf_hooks";
import { resolveCorrectionsNetworkWindow } from "./corrections-network-policy.mjs";

// Bounded, synthetic policy exercise only. This is not a player, database,
// network, Edge, or availability benchmark and sets no customer SLA.
export function correctionsScaleProbeOptions({ facilities = 24, samples = 10_000 } = {}) {
  const facilityCount = Number(facilities);
  const sampleCount = Number(samples);
  if (!Number.isInteger(facilityCount) || facilityCount < 3 || facilityCount > 100) {
    throw new Error("Synthetic facility count must be between 3 and 100.");
  }
  if (!Number.isInteger(sampleCount) || sampleCount < facilityCount * 5 || sampleCount > 50_000) {
    throw new Error("Synthetic samples must cover every facility and scenario, up to 50,000.");
  }
  return Object.freeze({ facilities: facilityCount, samples: sampleCount });
}

export function runCorrectionsScaleProbe(options, { resolve = resolveCorrectionsNetworkWindow, now = performance.now.bind(performance) } = {}) {
  const { facilities, samples } = correctionsScaleProbeOptions(options);
  const windows = [];
  const facilityIds = Array.from({ length: facilities }, (_, index) => `synthetic-facility-${index}`);
  for (const [index, facilityId] of facilityIds.entries()) {
    windows.push({ id: `central-${index}`, facilityId, kind: "CENTRAL", distributionId: `central-version-${index}`, weekday: 1, startMinute: 0, endMinute: 1440, active: true });
    if (index % 2 === 0) windows.push({ id: `local-${index}`, facilityId, kind: "LOCAL", distributionId: `local-version-${index}`, weekday: 1, startMinute: 600, endMinute: 660, active: true });
    windows.push({ id: `fallback-${index}`, facilityId, kind: "FALLBACK", distributionId: `private-fallback-${index}`, weekday: 1, startMinute: 0, endMinute: 1440, active: true });
  }
  const withdrawnWindows = windows.map((window) => window.kind === "CENTRAL" ? { ...window, active: false } : window);
  const durations = [];
  const scenarioCounts = { central: 0, localOrCentral: 0, returnToCentral: 0, privateFallback: 0, foreignFacilityDenied: 0 };
  let mismatchCount = 0;

  for (let index = 0; index < samples; index += 1) {
    const phase = index % 5;
    const facilityNumber = Math.floor(index / 5) % facilities;
    const facilityId = phase === 4 ? "synthetic-foreign-facility" : facilityIds[facilityNumber];
    const minute = phase === 1 ? 630 : phase === 2 || phase === 3 ? 700 : 540;
    const candidateWindows = phase === 3 ? withdrawnWindows : windows;
    const expectedId = phase === 4 ? null : phase === 3 ? `fallback-${facilityNumber}`
      : phase === 1 && facilityNumber % 2 === 0 ? `local-${facilityNumber}` : `central-${facilityNumber}`;
    const started = now();
    const selected = resolve(candidateWindows, { facilityId, weekday: 1, minute });
    durations.push(now() - started);
    if ((selected?.id || null) !== expectedId || (selected && selected.facilityId !== facilityId)) mismatchCount += 1;
    scenarioCounts[["central", "localOrCentral", "returnToCentral", "privateFallback", "foreignFacilityDenied"][phase]] += 1;
  }

  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(samples * 0.95) - 1];
  return Object.freeze({
    kind: "synthetic_c7_policy_only", facilities, samples, scenarioCounts, mismatchCount,
    p95ResolveMs: Math.round(p95 * 1000) / 1000,
    caveat: "No live player, database, network, Edge, customer data, or service-level claim was tested."
  });
}
