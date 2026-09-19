// Run an optional read-only diagnostic without delaying the station's AutoDJ
// lease-renewal loop. At most one inspection may be in flight per worker.
export function createStudioShadowScan({ inspect, report }) {
  if (typeof inspect !== "function" || typeof report !== "function") throw new Error("A shadow inspector and reporter are required.");
  let pending = null;
  let closed = false;
  let lastReason = null;

  function safeReport(state) {
    if (closed || state.reason === lastReason) return;
    lastReason = state.reason;
    try { report({ ready: state.ready === true, reason: state.reason }); }
    catch { /* Diagnostics must never interrupt the encoder. */ }
  }

  return {
    start(input) {
      if (closed || pending) return false;
      pending = Promise.resolve()
        .then(() => inspect(input))
        .then((state) => safeReport(state && typeof state.reason === "string" ? state : { ready: false, reason: "SHADOW_CHECK_FAILED" }))
        .catch(() => safeReport({ ready: false, reason: "SHADOW_CHECK_FAILED" }))
        .finally(() => { pending = null; });
      return true;
    },
    async close(timeoutMs = 5_000) {
      closed = true;
      if (!pending) return true;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new Error("Invalid shadow drain timeout.");
      let timer;
      try {
        return await Promise.race([
          pending.then(() => true),
          new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })
        ]);
      } finally { clearTimeout(timer); }
    }
  };
}
