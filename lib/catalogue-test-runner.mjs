// Bounded orchestration only: EVERY storage, database, clock and transport
// operation is injected. This module cannot grant rights or open a connection.
const MAX_TRACKS = 8;
const MAX_RESOURCES = 16;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const CALL_TIMEOUT_MS = 1_000;
const CLOSE_TIMEOUT_MS = 2_000;

export class CatalogueTestRunnerError extends Error {
  constructor(code) { super(code); this.name = "CatalogueTestRunnerError"; this.code = code; }
}
const failure = code => new CatalogueTestRunnerError(code);
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);
const finiteDate = value => value instanceof Date && Number.isFinite(value.getTime());

function authorizedSession(value, sessionId, now) {
  if (value?.authorized !== true || value.id !== sessionId || !identifier(value.organisationId) || !identifier(value.stationId) ||
      !(value.channelId === null || identifier(value.channelId)) || !Number.isInteger(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 300 ||
      !finiteDate(value.deadlineAt) || !finiteDate(value.authorizationExpiresAt) || value.authorizationExpiresAt > value.deadlineAt ||
      value.deadlineAt.getTime() <= now || value.authorizationExpiresAt.getTime() <= now ||
      typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      !Array.isArray(value.tracks) || !value.tracks.length || value.tracks.length > MAX_TRACKS) {
    throw failure("CATALOGUE_TEST_AUTHORIZATION_DENIED");
  }
  const ids = new Set();
  const tracks = value.tracks.map(track => {
    if (!identifier(track?.id) || ids.has(track.id) || !identifier(track.mediaAssetId) ||
        !Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0 || track.durationSeconds > 86_400) {
      throw failure("CATALOGUE_TEST_AUTHORIZATION_DENIED");
    }
    ids.add(track.id);
    return Object.freeze({ ...track });
  });
  return Object.freeze({ ...value, deadlineAt: new Date(value.deadlineAt), authorizationExpiresAt: new Date(value.authorizationExpiresAt), tracks: Object.freeze(tracks) });
}

/**
 * loadAuthorizedSession/heartbeat must enforce real, current owner approval,
 * subscription, tenant, territory and track rights. This runner deliberately
 * cannot change those permissions or convert sender diagnostics to proof-of-play.
 * registerResource must be called immediately on socket/child creation, BEFORE
 * any await. close() must resolve only when that resource is confirmed closed;
 * forceClose() must synchronously prevent further source writes and request kill.
 */
export async function runCatalogueTest(options = {}) {
  const { sessionId, loadAuthorizedSession, claim, heartbeat, appendEvent, finish, prepareAudio, connectSource, playTrack, clock, signal: parentSignal } = options;
  for (const operation of [loadAuthorizedSession, claim, heartbeat, appendEvent, finish, prepareAudio, connectSource, playTrack]) {
    if (typeof operation !== "function") throw failure("CATALOGUE_TEST_ADAPTERS_REQUIRED");
  }
  if (!identifier(sessionId) || !clock || ["now", "monotonicNow", "setTimeout", "clearTimeout"].some(key => typeof clock[key] !== "function") ||
      (parentSignal && (typeof parentSignal.aborted !== "boolean" || typeof parentSignal.addEventListener !== "function" || typeof parentSignal.removeEventListener !== "function"))) {
    throw failure("CATALOGUE_TEST_OPTIONS_INVALID");
  }
  const epoch = () => {
    const value = clock.now();
    if (!Number.isFinite(value)) throw failure("CATALOGUE_TEST_CLOCK_INVALID");
    return value;
  };
  const monotonic = () => {
    const value = clock.monotonicNow();
    if (!Number.isFinite(value)) throw failure("CATALOGUE_TEST_CLOCK_INVALID");
    return value;
  };
  const controller = new AbortController();
  const signal = controller.signal;
  const resources = new Set();
  let session = null, receipt = null, prepared = null, connection = null, deadlineTimer = null, heartbeatTimer = null;
  let closed = false, sequence = 0, audioBytesSent = 0, tracksEnded = 0, activeTrack = null, heartbeatPending = false;
  let hardDeadlineMono = Infinity, result = null, stopConfirmed = true, eventWrites = Promise.resolve();
  const forceResource = resource => {
    try { resource.forceClose(); }
    catch { stopConfirmed = false; }
  };
  const abort = code => {
    if (!signal.aborted) controller.abort(failure(code));
    for (const resource of resources) forceResource(resource);
  };
  const onParentAbort = () => abort("CATALOGUE_TEST_ABORTED");
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  if (parentSignal?.aborted) onParentAbort();

  // Lazy invocation prevents abandoned promises when cancellation has already
  // happened. Late resource results are still disposed, never adopted for play.
  function bounded(operation, milliseconds, operationSignal = signal, late = null, timeoutCode = "CATALOGUE_TEST_ADAPTER_TIMEOUT") {
    if (operationSignal?.aborted) return Promise.reject(operationSignal.reason);
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const cleanup = () => { clock.clearTimeout(timer); operationSignal?.removeEventListener("abort", cancelled); };
      const done = (value, error) => {
        if (settled) { if (!error && late) { try { late(value); } catch { /* late cleanup never restarts a test */ } } return; }
        settled = true; cleanup();
        if (error) reject(error); else resolve(value);
      };
      const cancelled = () => done(null, operationSignal.reason);
      operationSignal?.addEventListener("abort", cancelled, { once: true });
      timer = clock.setTimeout(() => {
        // These operations use the remaining test window, not an independent
        // adapter timeout. Either equal-deadline timer must report the same stop.
        if (timeoutCode === "CATALOGUE_TEST_DEADLINE") abort(timeoutCode);
        done(null, failure(timeoutCode));
      }, Math.max(1, milliseconds));
      Promise.resolve().then(() => {
        if (operationSignal?.aborted) throw operationSignal.reason;
        return operation();
      }).then(value => done(value), error => done(null, error));
      if (operationSignal?.aborted) cancelled();
    });
  }
  const registerResource = resource => {
    if (!resource || typeof resource.forceClose !== "function" || typeof resource.close !== "function") {
      abort("CATALOGUE_TEST_RESOURCE_INVALID");
      throw failure("CATALOGUE_TEST_RESOURCE_INVALID");
    }
    if (!resources.has(resource) && resources.size >= MAX_RESOURCES) {
      forceResource(resource); abort("CATALOGUE_TEST_RESOURCE_LIMIT");
      throw failure("CATALOGUE_TEST_RESOURCE_LIMIT");
    }
    resources.add(resource);
    if (signal.aborted || closed) forceResource(resource);
    // Unregister only after the adapter has independently confirmed closure.
    return () => resources.delete(resource);
  };
  const disposeLate = value => {
    if (value?.dispose) void bounded(() => value.dispose(), CLOSE_TIMEOUT_MS, null).catch(() => undefined);
  };
  const closeLate = value => {
    if (!value || typeof value.forceClose !== "function" || typeof value.close !== "function") return;
    forceResource(value);
    void bounded(() => value.close(), CLOSE_TIMEOUT_MS, null).catch(() => undefined);
  };
  const checkDeadline = () => {
    if (monotonic() >= hardDeadlineMono || (session && epoch() >= Math.min(session.deadlineAt.getTime(), session.authorizationExpiresAt.getTime()))) abort("CATALOGUE_TEST_DEADLINE");
    signal.throwIfAborted();
  };
  const persist = (type, details = {}, terminal = false) => {
    const event = { sequence: ++sequence, type, occurredAt: new Date(epoch()), ...details };
    const write = () => bounded(() => appendEvent({ sessionId, session, claim: receipt, event }), CALL_TIMEOUT_MS, terminal ? null : signal)
      .then(value => { if (value === false) throw failure("CATALOGUE_TEST_EVENT_WRITE_FAILED"); });
    const pending = eventWrites.then(write);
    eventWrites = pending.catch(() => { if (!terminal) abort("CATALOGUE_TEST_EVENT_WRITE_FAILED"); });
    return pending;
  };
  const verifyHeartbeat = async () => {
    checkDeadline();
    const status = await bounded(() => heartbeat({ sessionId, session, claim: receipt, now: new Date(epoch()), signal }), CALL_TIMEOUT_MS);
    if (status?.authorized !== true || status.leaseHeld !== true) throw failure("CATALOGUE_TEST_AUTHORIZATION_REVOKED");
    if (status.fingerprint !== session.fingerprint) throw failure("CATALOGUE_TEST_CONFIGURATION_CHANGED");
    checkDeadline();
  };
  const scheduleHeartbeat = () => {
    if (signal.aborted || closed) return;
    heartbeatTimer = clock.setTimeout(() => {
      if (signal.aborted || closed || heartbeatPending) return;
      heartbeatPending = true;
      void verifyHeartbeat().catch(error => abort(error instanceof CatalogueTestRunnerError ? error.code : "CATALOGUE_TEST_HEARTBEAT_FAILED"))
        .finally(() => { heartbeatPending = false; scheduleHeartbeat(); });
    }, 1_000);
  };
  const context = () => ({ sessionId, session, claim: receipt, signal, registerResource });
  try {
    signal.throwIfAborted();
    const loaded = await bounded(() => loadAuthorizedSession({ sessionId, now: new Date(epoch()), signal }), CALL_TIMEOUT_MS);
    session = authorizedSession(loaded, sessionId, epoch());
    const remaining = Math.min(session.durationSeconds * 1_000, session.deadlineAt.getTime() - epoch(), session.authorizationExpiresAt.getTime() - epoch());
    hardDeadlineMono = monotonic() + remaining;
    deadlineTimer = clock.setTimeout(() => abort("CATALOGUE_TEST_DEADLINE"), Math.max(1, remaining));
    checkDeadline();
    receipt = await bounded(() => claim({ sessionId, session, now: new Date(epoch()), signal }), CALL_TIMEOUT_MS, signal, late => {
      if (late?.claimed === true) void bounded(() => finish({ sessionId, session, claim: late,
        result: { status: "STOPPED", code: "CATALOGUE_TEST_ABORTED", stopConfirmed: true, audioBytesSent: 0 }, releaseAllowed: true }), CALL_TIMEOUT_MS, null).catch(() => undefined);
    });
    if (receipt?.claimed !== true || !identifier(receipt.leaseId)) throw failure("CATALOGUE_TEST_LEASE_NOT_CLAIMED");
    await persist("TEST_CLAIMED");
    await verifyHeartbeat();
    scheduleHeartbeat();
    prepared = await bounded(() => prepareAudio(context()), Math.max(1, hardDeadlineMono - monotonic()), signal, disposeLate, "CATALOGUE_TEST_DEADLINE");
    if (!prepared || typeof prepared.dispose !== "function") throw failure("CATALOGUE_TEST_PREPARATION_INVALID");
    await verifyHeartbeat();
    connection = await bounded(() => connectSource({ ...context(), prepared }), Math.max(1, hardDeadlineMono - monotonic()), signal, closeLate, "CATALOGUE_TEST_DEADLINE");
    if (!connection || typeof connection.forceClose !== "function" || typeof connection.close !== "function") throw failure("CATALOGUE_TEST_SOURCE_RESOURCE_INVALID");
    registerResource(connection);
    if (connection?.authenticated !== true) throw failure("CATALOGUE_TEST_SOURCE_NOT_AUTHENTICATED");
    await persist("SOURCE_AUTHENTICATED");
    for (const track of session.tracks) {
      await verifyHeartbeat();
      const state = { track, observedBytes: 0, firstAudio: false, accounted: false, endAttempted: false };
      activeTrack = state;
      const emit = observation => {
        if (closed || signal.aborted) return Promise.resolve(false);
        if (activeTrack !== state || observation?.type !== "AUDIO_SENT" || observation.trackId !== track.id ||
            !Number.isSafeInteger(observation.audioBytesSent) || observation.audioBytesSent <= 0 ||
            observation.audioBytesSent < state.observedBytes || observation.audioBytesSent > MAX_AUDIO_BYTES) {
          abort("CATALOGUE_TEST_AUDIO_OBSERVATION_INVALID"); return Promise.resolve(false);
        }
        state.observedBytes = observation.audioBytesSent;
        if (state.firstAudio) return Promise.resolve(true);
        state.firstAudio = true;
        return persist("TRACK_AUDIO_SENT", { trackId: track.id, mediaAssetId: track.mediaAssetId, audioBytesSent: observation.audioBytesSent })
          .then(() => true, () => false);
      };
      const played = await bounded(() => playTrack({ ...context(), prepared, connection, track, emit }), Math.max(1, hardDeadlineMono - monotonic()), signal, null, "CATALOGUE_TEST_DEADLINE");
      await eventWrites;
      checkDeadline();
      if (!state.firstAudio || !Number.isSafeInteger(played?.audioBytesSent) || played.audioBytesSent < state.observedBytes ||
          played.audioBytesSent > MAX_AUDIO_BYTES || typeof played.completed !== "boolean" ||
          (played.endedReason !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(played.endedReason))) throw failure("CATALOGUE_TEST_AUDIO_RESULT_INVALID");
      audioBytesSent += played.audioBytesSent;
      state.accounted = true;
      if (audioBytesSent > MAX_AUDIO_BYTES) throw failure("CATALOGUE_TEST_AUDIO_BUDGET_EXCEEDED");
      state.endAttempted = true;
      await persist("TRACK_ENDED", { trackId: track.id, mediaAssetId: track.mediaAssetId, audioBytesSent: played.audioBytesSent,
        completed: played.completed, endedReason: played.endedReason || (played.completed ? "SOURCE_FILE_ENDED" : "SOURCE_INTERRUPTED") });
      activeTrack = null; tracksEnded += 1;
      if (!played.completed) throw failure("CATALOGUE_TEST_TRACK_INTERRUPTED");
    }
    result = { status: "COMPLETED", code: "CATALOGUE_TEST_COMPLETED" };
  } catch (error) {
    const code = error instanceof CatalogueTestRunnerError ? error.code : signal.aborted ? signal.reason.code : "CATALOGUE_TEST_ADAPTER_FAILED";
    result = { status: !receipt?.claimed ? "REFUSED" : ["CATALOGUE_TEST_DEADLINE", "CATALOGUE_TEST_ABORTED"].includes(code) ? "STOPPED" : "FAILED", code };
  } finally {
    closed = true;
    clock.clearTimeout(deadlineTimer); clock.clearTimeout(heartbeatTimer);
    parentSignal?.removeEventListener("abort", onParentAbort);
    if (!signal.aborted) controller.abort(failure("CATALOGUE_TEST_FINISHED"));
    for (const resource of resources) forceResource(resource);
    const confirmations = await Promise.all([...resources].map(async resource => {
      try { const confirmation = await bounded(() => resource.close(), CLOSE_TIMEOUT_MS, null); return confirmation !== false && confirmation?.closed !== false; }
      catch { return false; }
    }));
    stopConfirmed = stopConfirmed && confirmations.every(Boolean);
    if (stopConfirmed && prepared?.dispose) {
      try { await bounded(() => prepared.dispose(), CLOSE_TIMEOUT_MS, null); }
      catch { result = { status: "FAILED", code: "CATALOGUE_TEST_CLEANUP_FAILED" }; }
    }
    if (!stopConfirmed) result = { status: "FAILED", code: "CATALOGUE_TEST_STOP_UNCONFIRMED" };
    if (activeTrack?.firstAudio && !activeTrack.endAttempted) {
      if (!activeTrack.accounted) audioBytesSent += activeTrack.observedBytes;
      try {
        await persist("TRACK_ENDED", { trackId: activeTrack.track.id, mediaAssetId: activeTrack.track.mediaAssetId,
          audioBytesSent: activeTrack.observedBytes, completed: false, endedReason: "TEST_STOPPED", stopConfirmed }, true);
      } catch { /* a source observation remains diagnostic, not fabricated proof */ }
    }
    result = { ...result, sessionId, audioBytesSent, tracksEnded, stopConfirmed, preparedPreserved: Boolean(prepared && !stopConfirmed), finishRecorded: false };
    if (receipt?.claimed === true) {
      try { await persist("TEST_ENDED", { status: result.status, code: result.code, stopConfirmed, audioBytesSent }, true); }
      catch { /* terminal reporting failure never permits another source attempt */ }
      try {
        const recorded = await bounded(() => finish({ sessionId, session, claim: receipt, result: { ...result }, releaseAllowed: stopConfirmed }), CALL_TIMEOUT_MS, null);
        result.finishRecorded = recorded !== false;
      } catch { /* bounded best-effort bookkeeping; no restart/retry */ }
    }
  }
  return Object.freeze(result);
}
