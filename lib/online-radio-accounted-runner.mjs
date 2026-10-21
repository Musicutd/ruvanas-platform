// Injected orchestration only: no database, storage, source or encoder imports.
// A failure in rights, lease or durable accounting stops source resources first.
const failure = code => Object.assign(new Error(code), { code });
const SAFE_REASONS = new Set(["SHUTDOWN", "POLICY_CHANGED", "RIGHTS_REVOKED", "LEASE_LOST", "SOURCE_INTERRUPTED",
  "SOURCE_DISCONNECTED", "SOURCE_ENCODER_FAILED", "DELIVERY_RECORD_FAILED", "UNKNOWN_FAILURE"]);

export async function runAccountedRotation({ entries, loadApproval, renewLease, prepareAudio, connectSource, playTrack,
  ledger, signal: parentSignal, guardIntervalMs = 1000, guardTimeoutMs = 2000, maxSegments = 3000, now = Date.now } = {}) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000 ||
      entries.some(entry => !entry?.track?.id || !entry.track.mediaAsset?.id) ||
      [loadApproval, renewLease, prepareAudio, connectSource, playTrack, now].some(fn => typeof fn !== "function") ||
      typeof ledger?.record !== "function" || typeof ledger?.drain !== "function" ||
      !Number.isSafeInteger(guardIntervalMs) || guardIntervalMs < 10 || guardIntervalMs > 10000 ||
      !Number.isSafeInteger(guardTimeoutMs) || guardTimeoutMs < 1 || guardTimeoutMs > 10000 ||
      !Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 3000) throw failure("ENCODER_RUNNER_OPTIONS_INVALID");
  const controller = new AbortController(), signal = controller.signal, resources = new Set();
  let stopConfirmed = true, prepared = null, connection = null, active = null, approvalUntil = null;
  let guardTimer = null, guardDeadline = null, boundaryTimer = null, guarding = false, closed = false;
  let sequence = 0, endedSegments = 0, reason = null, ledgerFailed = false;
  const abort = code => {
    if (!signal.aborted) controller.abort(failure(SAFE_REASONS.has(code) ? code : "UNKNOWN_FAILURE"));
    for (const resource of resources) { try { resource.forceClose(); } catch { stopConfirmed = false; } }
  };
  const onParent = () => abort(parentSignal?.reason?.code === "POLICY_CHANGED" ? "POLICY_CHANGED" : "SHUTDOWN");
  parentSignal?.addEventListener("abort", onParent, { once: true });
  if (parentSignal?.aborted) onParent();
  const registerResource = resource => {
    if (!resource || typeof resource.forceClose !== "function" || typeof resource.close !== "function" || resources.size >= 8) {
      try { resource?.forceClose?.(); } catch { stopConfirmed = false; }
      abort("UNKNOWN_FAILURE"); throw failure("ENCODER_RESOURCE_INVALID");
    }
    resources.add(resource);
    if (signal.aborted || closed) resource.forceClose();
    return () => resources.delete(resource);
  };
  async function bounded(operation, timeoutMs, cancellable = true, lateCleanup = null) {
    if (cancellable) signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let settled = false;
      const complete = (value, error) => {
        if (settled) { if (!error && lateCleanup) void Promise.resolve().then(() => lateCleanup(value)).catch(() => {}); return; }
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve(value);
      };
      const cancel = () => complete(null, signal.reason);
      const timer = setTimeout(() => complete(null, failure("ENCODER_ADAPTER_TIMEOUT")), timeoutMs);
      if (cancellable) signal.addEventListener("abort", cancel, { once: true });
      Promise.resolve().then(() => { if (cancellable) signal.throwIfAborted(); return operation(); }).then(value => complete(value), error => complete(null, error));
      if (cancellable && signal.aborted) cancel();
    });
  }
  async function approve() {
    const result = await bounded(() => loadApproval({ entry: active?.entry || null, now: new Date(now()), signal }), guardTimeoutMs);
    if (result?.allowed !== true || !(result.approvedUntil instanceof Date) || !Number.isFinite(result.approvedUntil.getTime()) ||
        result.approvedUntil.getTime() <= now()) throw failure("RIGHTS_REVOKED");
    if (await bounded(() => renewLease({ signal }), guardTimeoutMs) !== true) throw failure("LEASE_LOST");
    approvalUntil = result.approvedUntil.getTime();
    clearTimeout(boundaryTimer);
    boundaryTimer = setTimeout(() => abort("RIGHTS_REVOKED"), Math.max(1, Math.min(2147483647, approvalUntil - now())));
  }
  const guarded = async () => {
    if (guarding || signal.aborted || closed) return;
    guarding = true;
    guardDeadline = setTimeout(() => abort("RIGHTS_REVOKED"), guardTimeoutMs * 2 + 10);
    try { await approve(); }
    catch (error) { abort(error.code === "LEASE_LOST" ? "LEASE_LOST" : "RIGHTS_REVOKED"); }
    finally { clearTimeout(guardDeadline); guarding = false; }
  };
  async function record(type, state, details = {}) {
    try {
      await bounded(() => ledger.record({ type, segmentSequence: state.sequence, trackId: state.entry.track.id,
        mediaAssetId: state.entry.track.mediaAsset.id, eventAt: new Date(now()), ...details }), 3000, false);
    } catch { ledgerFailed = true; abort("DELIVERY_RECORD_FAILED"); throw failure("DELIVERY_RECORD_FAILED"); }
  }
  try {
    await approve();
    guardTimer = setInterval(() => { void guarded(); }, guardIntervalMs);
    prepared = await bounded(() => prepareAudio({ entries, signal, registerResource }), 120000, true,
      value => value?.dispose?.());
    signal.throwIfAborted(); await approve();
    connection = await bounded(() => connectSource({ signal, registerResource }), 10000, true,
      value => { value?.forceClose?.(); return value?.close?.(); });
    if (connection?.authenticated !== true) throw failure("SOURCE_DISCONNECTED");
    for (let index = 0; sequence < maxSegments && !signal.aborted; index++) {
      const entry = entries[index % entries.length];
      active = { entry, sequence: ++sequence, bytes: 0, seconds: 0, audioRecorded: false, startRecorded: false, terminalAttempted: false };
      await approve();
      await record("STARTED", active); active.startRecorded = true;
      const state = active;
      const emit = async observation => {
        signal.throwIfAborted();
        if (active !== state || !Number.isSafeInteger(observation?.audioBytesSent) || observation.audioBytesSent <= state.bytes ||
            !Number.isFinite(observation.encodedSecondsSent) || observation.encodedSecondsSent < state.seconds ||
            observation.audioBytesSent > 1024 ** 4 || observation.encodedSecondsSent > 86400) throw failure("SOURCE_ENCODER_FAILED");
        state.bytes = observation.audioBytesSent; state.seconds = observation.encodedSecondsSent;
        if (!state.audioRecorded) {
          await record("AUDIO_SENT", state, { transmittedBytes: state.bytes, transmittedSeconds: state.seconds, observationBasis: "SOURCE_WRITE_CALLBACK" });
          state.audioRecorded = true;
        }
        return true;
      };
      const durationMs = Math.min(86400, Number(entry.track.mediaAsset.durationSeconds)) * 1000 + 5000;
      const result = await bounded(() => playTrack({ prepared, connection, entry, signal, emit, registerResource }), durationMs);
      signal.throwIfAborted();
      if (result?.completed !== true || !state.audioRecorded || result.audioBytesSent !== state.bytes || result.encodedSecondsSent !== state.seconds) throw failure("SOURCE_ENCODER_FAILED");
      state.terminalAttempted = true;
      await record("ENDED", state, { transmittedBytes: state.bytes, transmittedSeconds: state.seconds,
        observationBasis: "SOURCE_WRITE_CALLBACK", reasonCode: "SOURCE_FILE_ENDED" });
      active = null; endedSegments++;
    }
    if (signal.aborted) signal.throwIfAborted();
  } catch (error) {
    reason = signal.aborted ? signal.reason.code : SAFE_REASONS.has(error?.code) ? error.code : "SOURCE_ENCODER_FAILED";
    abort(reason);
  } finally {
    closed = true; clearInterval(guardTimer); clearTimeout(guardDeadline); clearTimeout(boundaryTimer);
    parentSignal?.removeEventListener("abort", onParent);
    if (!signal.aborted) abort("SHUTDOWN");
    const confirmations = await Promise.all([...resources].map(async resource => {
      try { const result = await bounded(() => resource.close(), 2500, false); return result !== false && result?.closed !== false; }
      catch { return false; }
    }));
    stopConfirmed = stopConfirmed && confirmations.every(Boolean);
    if (active?.startRecorded && !active.terminalAttempted && !ledgerFailed) {
      active.terminalAttempted = true;
      const safeReason = SAFE_REASONS.has(reason) ? reason : "SOURCE_INTERRUPTED";
      try { await record(["SHUTDOWN", "POLICY_CHANGED", "RIGHTS_REVOKED", "LEASE_LOST"].includes(safeReason) ? "INTERRUPTED" : "FAILED", active,
        { reasonCode: safeReason, ...(active.audioRecorded ? { transmittedBytes: active.bytes, transmittedSeconds: active.seconds, observationBasis: "SOURCE_WRITE_CALLBACK" } : {}) }); }
      catch { /* unresolved reservation is UNKNOWN, never completed */ }
    }
    if (stopConfirmed && prepared?.dispose) {
      try { await bounded(() => prepared.dispose(), 2500, false); } catch { reason = "UNKNOWN_FAILURE"; }
    }
    try { await bounded(() => ledger.drain(), 3000, false); } catch { ledgerFailed = true; }
  }
  if (ledgerFailed) reason = "DELIVERY_RECORD_FAILED";
  else if (!stopConfirmed) reason = "UNKNOWN_FAILURE";
  return Object.freeze({ status: ledgerFailed || !stopConfirmed ? "FAILED" : reason ? "STOPPED" : "COMPLETE", reasonCode: reason,
    endedSegments, stopConfirmed, quarantined: ledgerFailed || !stopConfirmed,
    listenerProof: false, royaltyConfirmed: false });
}
