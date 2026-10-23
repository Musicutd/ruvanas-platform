// Continuous Test Radio orchestration. No network/process work occurs on import.
// Its durable owner grant is separate from the old bounded catalogue-test mode.
import { performance } from 'node:perf_hooks';

export const CONTINUOUS_STATION_ID = 'cmvcnbwi20008hr23sd76psi8';
export const CONTINUOUS_WORKER_ID = 'srv-damhnbv40ujc73b00lgg';
const fail = code => Object.assign(new Error(code), { code });
export function continuousDatabaseRoute(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && /^dpg-[a-z0-9-]+$/.test(url.hostname) &&
      (!url.port || url.port === '5432') && !url.hash &&
      ![...url.searchParams.keys()].some(key => /^(host|hostaddr|port|service)$/i.test(key))
      ? 'PRIVATE_RENDER_DATABASE' : 'REVIEW_REQUIRED';
  } catch { return 'REVIEW_REQUIRED'; }
}
export function continuousWorkerMode(args = [], env = {}) {
  if (args.length === 0 || args.length === 1 && args[0] === '--check') return 'CHECK_ONLY';
  if (args.length !== 3 || args[0] !== '--serve' || args[1] !== `--station=${CONTINUOUS_STATION_ID}` || args[2] !== '--monthly-budget-usd=15') throw fail('CONTINUOUS_ARGUMENTS_INVALID');
  if (env.RENDER_SERVICE_ID !== CONTINUOUS_WORKER_ID) throw fail('CONTINUOUS_WRONG_WORKER');
  return 'SERVE_OWNER_CONTINUOUS_GRANT';
}

export function continuousSafeCode(error) {
  return /^(CONTINUOUS|TEST|CATALOGUE_TEST)_[A-Z_]{1,80}$/.test(error?.code || '') ? error.code : 'CONTINUOUS_OPERATION_FAILED';
}

// Durable dashboard observations accept only this namespace. Transport/codec
// codes can still be logged safely, but must not make the ERROR write fail.
export function continuousObservationReasonCode(error) {
  return /^CONTINUOUS_[A-Z_]{1,80}$/.test(error?.code || '') ? error.code : 'CONTINUOUS_STREAM_FAILED';
}

export function continuousWait(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

export async function continuousBounded(operation, signal, milliseconds = 5000) {
  signal.throwIfAborted();
  let timer, onAbort;
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail('CONTINUOUS_OPERATION_TIMEOUT')), milliseconds);
        onAbort = () => reject(signal.reason || fail('CONTINUOUS_STOPPED'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}

// Source bytes are reserved durably BEFORE sending. Abandoned allocations are
// intentionally not refunded. At month rollover a fresh reservation is needed.
export function createContinuousByteGuard({ reserve, write, signal, now = () => new Date(), allocationBytes = 1024 * 1024 }) {
  if (typeof reserve !== 'function' || typeof write !== 'function' || !Number.isSafeInteger(allocationBytes) || allocationBytes < 65536 || allocationBytes > 2 * 1024 * 1024) throw fail('CONTINUOUS_BUDGET_OPTIONS_INVALID');
  let remaining = 0, month = null, total = 0, pending = null, reservationError = null;
  function preallocate(instant, allocationMonth) {
    if (pending) return pending;
    pending = continuousBounded(() => reserve({ bytes: allocationBytes, now: instant }), signal).then(allocation => {
      if (allocation?.reservedBytes !== allocationBytes || allocation.monthKey !== allocationMonth) throw fail('CONTINUOUS_BUDGET_RESERVATION_INVALID');
      signal.throwIfAborted();
      if (month === allocationMonth) remaining += allocationBytes;
    }).catch(error => { reservationError = error; }).finally(() => { pending = null; });
    return pending;
  }
  return Object.freeze({
    async write(chunk) {
      signal.throwIfAborted();
      if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > 65536) throw fail('CONTINUOUS_SOURCE_CHUNK_INVALID');
      const instant = now();
      if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw fail('CONTINUOUS_CLOCK_INVALID');
      const currentMonth = instant.toISOString().slice(0, 7);
      if (month !== currentMonth) { remaining = 0; month = currentMonth; }
      if (reservationError) throw reservationError;
      if (remaining < chunk.length) {
        if (pending) await pending;
        if (reservationError) throw reservationError;
        if (remaining < chunk.length) await preallocate(instant, currentMonth);
        if (reservationError) throw reservationError;
        signal.throwIfAborted();
        if (remaining < chunk.length) throw fail('CONTINUOUS_BUDGET_RESERVATION_INVALID');
      }
      // Charge attempted bytes even if the source callback subsequently fails.
      remaining -= chunk.length;
      // Obtain the next minute of allowance while >16 seconds remain. The
      // real-time source path does not normally wait for a database roundtrip.
      if (remaining <= allocationBytes / 4 && !pending) void preallocate(instant, currentMonth);
      await continuousBounded(() => write(chunk), signal, 3000);
      total += chunk.length;
      return total;
    },
    get totalBytes() { return total; }
  });
}

// A DB stall must never keep a source alive after its short authority window.
// The independent timer kills registered sockets/children immediately; closure
// is awaited separately before releasing the station's exclusive lease.
export function createContinuousWatchdog({ signal, authorityMs = 12000, monotonicNow = () => performance.now() } = {}) {
  const controller = new AbortController(), resources = new Set();
  let validUntil = monotonicNow() + authorityMs, closed = false;
  const abort = reason => {
    if (!controller.signal.aborted) controller.abort(reason || fail('CONTINUOUS_STOPPED'));
    for (const resource of resources) { try { resource.forceClose(); } catch {} }
  };
  const parentStop = () => abort(signal.reason);
  signal.addEventListener('abort', parentStop, { once: true });
  const timer = setInterval(() => { if (monotonicNow() >= validUntil) abort(fail('CONTINUOUS_AUTHORITY_EXPIRED')); }, Math.min(250, authorityMs));
  if (signal.aborted) parentStop();
  return Object.freeze({
    signal: controller.signal,
    abort,
    approve() { controller.signal.throwIfAborted(); validUntil = monotonicNow() + authorityMs; },
    registerResource(resource) {
      if (!resource || typeof resource.forceClose !== 'function' || typeof resource.close !== 'function') throw fail('CONTINUOUS_RESOURCE_INVALID');
      if (closed || controller.signal.aborted) { resource.forceClose(); throw fail('CONTINUOUS_STOPPED'); }
      resources.add(resource);
      return () => resources.delete(resource);
    },
    async close() {
      closed = true; clearInterval(timer); signal.removeEventListener('abort', parentStop); abort(fail('CONTINUOUS_STOPPED'));
      const result = await Promise.allSettled([...resources].map(resource => continuousBounded(() => resource.close(), new AbortController().signal, 2500)));
      resources.clear();
      return result.every(item => item.status === 'fulfilled');
    },
    get resourceCount() { return resources.size; }
  });
}

// Serial, coalescing status updates; never an unbounded promise chain. A write
// failure closes audio via onError, but normal DB latency cannot delay PCM.
export function createContinuousObservationQueue({ write, onError }) {
  let latest = null, task = null, failed = false;
  async function drain() {
    while (latest !== null && !failed) {
      const value = latest; latest = null;
      try { await write(value); }
      catch (error) { failed = true; latest = null; onError(error); }
    }
  }
  function start() {
    if (!task) task = drain().finally(() => { task = null; if (latest !== null && !failed) start(); });
  }
  return Object.freeze({
    push(value) {
      if (failed) return false;
      latest = value;
      start();
      return true;
    },
    async flush() { while (task) await task; return !failed; }
  });
}
