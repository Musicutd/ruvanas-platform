const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function enterpriseProbeOptions({ baseUrl, samples = 100, concurrency = 5 } = {}) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error("ENTERPRISE_PROBE_BASE_URL must be a valid URL."); }
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error("The enterprise probe may run only against a local application instance.");
  const sampleCount = Number(samples);
  const workerCount = Number(concurrency);
  if (!Number.isInteger(sampleCount) || sampleCount < 100 || sampleCount > 10_000) throw new Error("Probe samples must be between 100 and 10,000.");
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 20) throw new Error("Probe concurrency must be between 1 and 20.");
  return Object.freeze({ baseUrl: url.origin, samples: sampleCount, concurrency: workerCount });
}

export function enterpriseProbeSummary(samples = []) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("At least one probe sample is required.");
  const ordered = samples.map((sample) => ({ durationMs: Number(sample.durationMs), status: Number(sample.status) })).sort((a, b) => a.durationMs - b.durationMs);
  if (ordered.some((sample) => !Number.isFinite(sample.durationMs) || sample.durationMs < 0 || !Number.isInteger(sample.status))) throw new Error("Probe samples are invalid.");
  const errors = ordered.filter((sample) => sample.status !== 401).length;
  return Object.freeze({
    sampleCount: ordered.length,
    p95BoundaryMs: Math.round(ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)].durationMs),
    errorRatePercent: Math.round((errors / ordered.length) * 10_000) / 100
  });
}
