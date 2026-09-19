const MAX_RECHECK_GAP_MS = 1_000;
const POSITIVE_REASON = "SEQUENCE_CONTINUATION_CONSISTENT_NOT_ON_AIR";

function validInstant(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

function safeReason(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,99}$/.test(value)
    ? value : "SEQUENCE_CONTINUATION_UNAVAILABLE";
}

function decision(state, response, reason) {
  return { state, response, reason, commandIssued: false, sourceCommandAllowed: false, listenerVerified: false };
}

// This state belongs only to an offline policy rehearsal. It is not a source
// lease, encoder session, output ACK or authority to play protected media.
export function startTimedPreemptionRehearsal() {
  return Object.freeze({ status: "MONITORING", lastCheckedAt: null, haltReason: null });
}

// Model the *required* fail-closed response to a sequence of read-only
// continuation decisions. It never calls the worker, a queue socket or a
// stream. An actual adapter must separately execute and acknowledge any stop.
export function advanceTimedPreemptionRehearsal(state, { continuation, instant } = {}) {
  if (state?.status === "HALT_LATCHED") {
    return decision(state, "HALT_LATCHED", state.haltReason);
  }
  const now = validInstant(instant);
  const previous = validInstant(state?.lastCheckedAt);
  let reason = null;
  if (state?.status !== "MONITORING" || state.haltReason !== null ||
      (state.lastCheckedAt !== null && !previous)) {
    reason = "SEQUENCE_REHEARSAL_STATE_INVALID";
  } else if (!now) {
    reason = "SEQUENCE_REHEARSAL_CLOCK_INVALID";
  } else if (previous && (now <= previous || now - previous >= MAX_RECHECK_GAP_MS)) {
    reason = "SEQUENCE_REHEARSAL_RECHECK_MISSED";
  } else if (continuation?.sourceCommandAllowed !== false || continuation.listenerVerified !== false) {
    reason = "SEQUENCE_REHEARSAL_DIAGNOSTIC_UNTRUSTED";
  } else if (continuation.consistent !== true || continuation.reason !== POSITIVE_REASON) {
    reason = safeReason(continuation.reason);
  }
  if (reason) {
    return decision(Object.freeze({ status: "HALT_LATCHED", lastCheckedAt: now || previous,
      haltReason: reason }), "HALT_REQUIRED_NOT_EXECUTED", reason);
  }
  return decision(Object.freeze({ status: "MONITORING", lastCheckedAt: now, haltReason: null }),
    "CONTINUE_REHEARSAL_ONLY", POSITIVE_REASON);
}
