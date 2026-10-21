// Source-delivery diagnostics only. Importing this module has no side effects.
// These records never assert listener playback, royalties, or rights ownership.
import { createHash } from "node:crypto";

export const ONLINE_RADIO_DELIVERY_ACTION = "ONLINE_RADIO_SOURCE_DELIVERY_EVENT";
export const DELIVERY_REASON_CODES = Object.freeze([
  "SOURCE_FILE_ENDED", "SEGMENT_COMPLETED", "SOURCE_INTERRUPTED", "SOURCE_DISCONNECTED",
  "SOURCE_ENCODER_FAILED", "SOURCE_AUTHENTICATION_FAILED", "ENCODER_STOPPED", "POLICY_CHANGED",
  "RIGHTS_REVOKED", "SCHEDULE_TAKEOVER", "SCHEDULE_FINISHED", "SHUTDOWN", "LEASE_LOST",
  "DELIVERY_RECORD_FAILED", "TEST_STOPPED", "UNKNOWN_FAILURE"
]);
const TYPES = new Set(["STARTED", "AUDIO_SENT", "ENDED", "INTERRUPTED", "FAILED"]);
const REASONS = new Set(DELIVERY_REASON_CODES);
const BASES = new Set(["SOURCE_WRITE_CALLBACK", "ENCODER_OUTPUT_CALLBACK"]);
const IDENTITY_KEYS = ["organisationId", "stationId", "destinationId", "sessionId"];
const EVENT_KEYS = new Set([...IDENTITY_KEYS, "segmentSequence", "type", "trackId", "mediaAssetId", "eventAt",
  "transmittedSeconds", "transmittedBytes", "observationBasis", "reasonCode"]);
const MAX_EVENTS = 10000;
const MAX_SEGMENT_BYTES = 1024 ** 4;
const MAX_SEGMENT_SECONDS = 24 * 60 * 60;
export const SOURCE_DELIVERY_SECONDS_DECIMAL_PLACES = 6;

export class OnlineRadioDeliveryError extends Error {
  constructor(code) { super(code); this.name = "OnlineRadioDeliveryError"; this.code = code; }
}
const fail = code => new OnlineRadioDeliveryError(code);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => JSON.stringify(value === null || typeof value !== "object" ? value :
  Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) :
    Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));

function identityOf(input) {
  if (!isRecord(input)) throw fail("DELIVERY_IDENTITY_INVALID");
  const identity = {};
  for (const key of IDENTITY_KEYS) {
    // Opaque database/runtime identifiers only: no URLs, paths, emails, or secrets.
    if (typeof input[key] !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input[key])) throw fail("DELIVERY_IDENTITY_INVALID");
    identity[key] = input[key];
  }
  return identity;
}

export function validateDeliveryEvent(input) {
  if (!isRecord(input) || Object.keys(input).some(key => !EVENT_KEYS.has(key))) throw fail("DELIVERY_EVENT_INVALID");
  const identity = identityOf(input);
  for (const key of ["trackId", "mediaAssetId"]) {
    if (typeof input[key] !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input[key])) throw fail("DELIVERY_TRACK_IDENTITY_INVALID");
  }
  if (!TYPES.has(input.type) || !Number.isSafeInteger(input.segmentSequence) || input.segmentSequence < 1 || input.segmentSequence > MAX_EVENTS) throw fail("DELIVERY_SEGMENT_INVALID");
  if (!(typeof input.eventAt === "string" || input.eventAt instanceof Date)) throw fail("DELIVERY_TIMESTAMP_INVALID");
  const instant = new Date(input.eventAt);
  if (!Number.isFinite(instant.getTime())) throw fail("DELIVERY_TIMESTAMP_INVALID");
  if (["STARTED", "AUDIO_SENT"].includes(input.type) ? input.reasonCode != null : !REASONS.has(input.reasonCode)) throw fail("DELIVERY_REASON_INVALID");
  const rawSeconds = input.transmittedSeconds ?? null;
  const bytes = input.transmittedBytes ?? null;
  const basis = input.observationBasis ?? null;
  if (rawSeconds !== null && (!Number.isFinite(rawSeconds) || rawSeconds < 0 || rawSeconds > MAX_SEGMENT_SECONDS)) throw fail("DELIVERY_COUNTER_INVALID");
  // Quantize measured seconds BEFORE persistence. MPEG-frame fractions repeat
  // in binary; JSON/Prisma/PostgreSQL number codecs can otherwise disagree in
  // their final digits. This is a fixed event representation, not a tolerance
  // when comparing an immutable stored row. Exact byte counters are untouched.
  const seconds = rawSeconds === null ? null : Math.max(0, Number(rawSeconds.toFixed(SOURCE_DELIVERY_SECONDS_DECIMAL_PLACES)));
  if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_SEGMENT_BYTES)) throw fail("DELIVERY_COUNTER_INVALID");
  if ((seconds !== null || bytes !== null) && !BASES.has(basis)) throw fail("DELIVERY_OBSERVATION_REQUIRED");
  if (basis !== null && !BASES.has(basis)) throw fail("DELIVERY_OBSERVATION_INVALID");
  if (input.type === "STARTED" && (seconds !== null || bytes !== null || basis !== null)) throw fail("DELIVERY_START_COUNTERS_FORBIDDEN");
  if (input.type === "AUDIO_SENT" && (basis !== "SOURCE_WRITE_CALLBACK" || bytes === null || bytes <= 0 || (seconds !== null && seconds <= 0))) throw fail("DELIVERY_FIRST_AUDIO_INVALID");
  return Object.freeze({ ...identity, segmentSequence: input.segmentSequence, type: input.type,
    trackId: input.trackId, mediaAssetId: input.mediaAssetId, eventAt: instant.toISOString(),
    transmittedSeconds: seconds, transmittedBytes: bytes, observationBasis: basis, reasonCode: input.reasonCode ?? null });
}

export function deliveryEventId(event) {
  const checked = validateDeliveryEvent(event);
  // One immutable reservation, first-write observation, and terminal per segment.
  return `or_delivery_${sha256(canonical({ ...identityOf(checked), segmentSequence: checked.segmentSequence,
    phase: checked.type === "STARTED" ? "START" : checked.type === "AUDIO_SENT" ? "AUDIO" : "TERMINAL" }))}`;
}

function emptyState() {
  return { identity: null, lastSequence: 0, lastEventAt: null, activeSegment: null, eventsCount: 0,
    endedSegments: 0, interruptedSegments: 0, failedSegments: 0, audioObservedSegments: 0,
    observedTransmittedSeconds: 0, observedTransmittedBytes: 0, segmentsWithSeconds: 0, segmentsWithBytes: 0,
    listenerProof: false, royaltyConfirmed: false };
}

function advance(state, event) {
  const identity = identityOf(event);
  if (state.identity && canonical(identity) !== canonical(state.identity)) throw fail("DELIVERY_SESSION_MISMATCH");
  if (state.lastEventAt && event.eventAt < state.lastEventAt) throw fail("DELIVERY_TIMESTAMP_REGRESSION");
  const next = { ...state, identity, lastEventAt: event.eventAt, eventsCount: state.eventsCount + 1 };
  if (event.type === "STARTED") {
    if (state.activeSegment || event.segmentSequence !== state.lastSequence + 1) throw fail("DELIVERY_SEGMENT_ORDER_INVALID");
    next.lastSequence = event.segmentSequence;
    next.activeSegment = { ...event, firstAudioObserved: false, completionStatus: "UNKNOWN" };
    return next;
  }
  const active = state.activeSegment;
  if (!active || event.segmentSequence !== active.segmentSequence || event.trackId !== active.trackId || event.mediaAssetId !== active.mediaAssetId) throw fail("DELIVERY_SEGMENT_ORDER_INVALID");
  if (event.type === "AUDIO_SENT" && active.firstAudioObserved) throw fail("DELIVERY_EVENT_CONFLICT");
  if (event.type !== "AUDIO_SENT" && !active.firstAudioObserved && ((event.transmittedBytes ?? 0) > 0 || (event.transmittedSeconds ?? 0) > 0)) throw fail("DELIVERY_FIRST_AUDIO_MISSING");
  for (const counter of ["transmittedSeconds", "transmittedBytes"]) {
    if (event[counter] !== null && active[counter] !== null && event[counter] < active[counter]) throw fail("DELIVERY_COUNTER_REGRESSION");
  }
  if (active.observationBasis && event.observationBasis && event.observationBasis !== active.observationBasis) throw fail("DELIVERY_OBSERVATION_CHANGED");
  // An open segment's first source-write amount remains a measured lower bound;
  // no terminal event or natural completion is invented after a worker crash.
  const seconds = event.transmittedSeconds ?? active.transmittedSeconds;
  const bytes = event.transmittedBytes ?? active.transmittedBytes;
  if (seconds !== null) { next.observedTransmittedSeconds += seconds - (active.transmittedSeconds ?? 0); if (active.transmittedSeconds === null) next.segmentsWithSeconds += 1; }
  if (bytes !== null) { next.observedTransmittedBytes += bytes - (active.transmittedBytes ?? 0); if (active.transmittedBytes === null) next.segmentsWithBytes += 1; }
  if (event.type === "AUDIO_SENT") {
    next.audioObservedSegments += 1;
    next.activeSegment = { ...event, firstAudioObserved: true, completionStatus: "UNKNOWN" };
    return next;
  }
  next[`${event.type.toLowerCase()}Segments`] += 1;
  next.activeSegment = null;
  return next;
}

export function reconcileDeliveryEvents(events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) throw fail("DELIVERY_EVENT_LIMIT");
  let state = emptyState();
  const seen = new Map();
  for (const input of events) {
    const event = validateDeliveryEvent(input);
    const id = deliveryEventId(event), fingerprint = canonical(event);
    if (seen.has(id)) {
      if (seen.get(id) !== fingerprint) throw fail("DELIVERY_EVENT_CONFLICT");
      continue;
    }
    state = advance(state, event);
    seen.set(id, fingerprint);
  }
  return Object.freeze(state);
}

// Operational source-send report, not a distributor settlement or listener
// proof-of-play report. Callers must pass trusted adapter observations only.
export function senderUsageRows(events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) throw fail("DELIVERY_EVENT_LIMIT");
  const sessions = new Map(), unique = new Map();
  for (const input of events) {
    const event = validateDeliveryEvent(input), id = deliveryEventId(event);
    const fingerprint = canonical(event);
    if (unique.has(id)) {
      if (unique.get(id).fingerprint !== fingerprint) throw fail("DELIVERY_EVENT_CONFLICT");
      continue;
    }
    unique.set(id, { fingerprint, event });
    const key = canonical(identityOf(event));
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(event);
  }
  // Validate every session before exposing any aggregate. Interleaved sessions
  // are allowed, but out-of-order events within a session remain an error.
  for (const session of sessions.values()) reconcileDeliveryEvents(session);
  const rows = new Map(), segments = new Map();
  for (const { event } of unique.values()) {
    const key = canonical({ organisationId: event.organisationId, stationId: event.stationId, destinationId: event.destinationId,
      trackId: event.trackId, mediaAssetId: event.mediaAssetId });
    if (!rows.has(key)) rows.set(key, { organisationId: event.organisationId, stationId: event.stationId,
      destinationId: event.destinationId, trackId: event.trackId, mediaAssetId: event.mediaAssetId,
      firstEventAt: event.eventAt, lastEventAt: event.eventAt, startedSegments: 0, endedSegments: 0,
      interruptedSegments: 0, failedSegments: 0, unresolvedSegments: 0, audioObservedSegments: 0,
      observedTransmittedBytes: null, observedTransmittedSeconds: null, segmentsWithoutByteMeasurement: 0,
      segmentsWithoutSecondMeasurement: 0, lowerBoundOnly: false, sessionIds: new Set(), observationBases: new Set(),
      evidenceKind: "SOURCE_DELIVERY_DIAGNOSTIC", measurementMeaning: "SOURCE_OUTPUT_CALLBACK_NOT_REMOTE_PLAYBACK",
      listenerProof: false, royaltyConfirmed: false });
    const row = rows.get(key);
    row.sessionIds.add(event.sessionId);
    if (event.eventAt < row.firstEventAt) row.firstEventAt = event.eventAt;
    if (event.eventAt > row.lastEventAt) row.lastEventAt = event.eventAt;
    if (event.observationBasis) row.observationBases.add(event.observationBasis);
    const segmentKey = canonical({ ...identityOf(event), segmentSequence: event.segmentSequence });
    if (event.type === "STARTED") { row.startedSegments += 1; segments.set(segmentKey, { row, audio: null, terminal: null }); continue; }
    if (event.type === "AUDIO_SENT") { row.audioObservedSegments += 1; segments.get(segmentKey).audio = event; continue; }
    row[`${event.type.toLowerCase()}Segments`] += 1;
    segments.get(segmentKey).terminal = event;
  }
  for (const { row, audio, terminal } of segments.values()) {
    const bytes = terminal?.transmittedBytes ?? audio?.transmittedBytes ?? null;
    const seconds = terminal?.transmittedSeconds ?? audio?.transmittedSeconds ?? null;
    if (bytes === null) row.segmentsWithoutByteMeasurement += 1;
    else row.observedTransmittedBytes = (row.observedTransmittedBytes ?? 0) + bytes;
    if (seconds === null) row.segmentsWithoutSecondMeasurement += 1;
    else row.observedTransmittedSeconds = (row.observedTransmittedSeconds ?? 0) + seconds;
    if (!terminal || (bytes !== null && terminal.transmittedBytes === null) || (seconds !== null && terminal.transmittedSeconds === null)) row.lowerBoundOnly = true;
  }
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => {
    const { sessionIds, observationBases, ...values } = row;
    const unknownSegments = row.startedSegments - row.endedSegments - row.interruptedSegments - row.failedSegments;
    return Object.freeze({ ...values, unresolvedSegments: unknownSegments, unknownSegments,
      sourceCompletionStatus: unknownSegments ? "UNKNOWN" : "TERMINAL_EVENTS_RECORDED",
      sessionCount: sessionIds.size, observationBases: [...observationBases].sort() });
  });
}

function bounded(operation, timeoutMs) {
  let timer;
  return Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(fail("DELIVERY_WRITE_TIMEOUT")), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

export function createOnlineRadioDeliveryLedger({ prisma, identity, writeTimeoutMs = 2000, maxPending = 16, maxEvents = MAX_EVENTS } = {}) {
  const checkedIdentity = identityOf(identity);
  if (Object.keys(identity).some(key => !IDENTITY_KEYS.includes(key))) throw fail("DELIVERY_IDENTITY_INVALID");
  if (typeof prisma?.auditLog?.upsert !== "function" || !Number.isSafeInteger(writeTimeoutMs) || writeTimeoutMs < 1 || writeTimeoutMs > 10000 ||
      !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 64 || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS) throw fail("DELIVERY_LEDGER_CONFIG_INVALID");
  let reservedState = emptyState(), committedState = emptyState(), queue = Promise.resolve(), pending = 0, terminalError = null;
  const seen = new Map();
  const snapshot = () => structuredClone({ ...committedState, pendingEvents: pending, failed: Boolean(terminalError) });
  return Object.freeze({
    record(observation) {
      if (terminalError) return Promise.reject(terminalError);
      let event, id, fingerprint, nextState;
      try {
        if (!isRecord(observation) || IDENTITY_KEYS.some(key => Object.hasOwn(observation, key))) throw fail("DELIVERY_EVENT_IDENTITY_OVERRIDE");
        event = validateDeliveryEvent({ ...checkedIdentity, ...observation });
        id = deliveryEventId(event); fingerprint = canonical(event);
        if (seen.has(id)) {
          if (seen.get(id).fingerprint !== fingerprint) throw fail("DELIVERY_EVENT_CONFLICT");
          return seen.get(id).promise;
        }
        if (pending >= maxPending) throw fail("DELIVERY_QUEUE_FULL");
        if (seen.size >= maxEvents) throw fail("DELIVERY_EVENT_LIMIT");
        nextState = advance(reservedState, event);
      } catch (error) { return Promise.reject(error instanceof OnlineRadioDeliveryError ? error : fail("DELIVERY_EVENT_INVALID")); }
      const details = { schemaVersion: 1, evidenceKind: "SOURCE_DELIVERY_DIAGNOSTIC", listenerProof: false, royaltyConfirmed: false, event };
      pending += 1; reservedState = nextState;
      const promise = queue.then(async () => {
        if (terminalError) throw terminalError;
        try {
          const row = await bounded(() => prisma.auditLog.upsert({ where: { id }, update: {}, create: {
            id, organisationId: checkedIdentity.organisationId, action: ONLINE_RADIO_DELIVERY_ACTION,
            entityType: "Station", entityId: checkedIdentity.stationId, details, createdAt: new Date(event.eventAt)
          } }), writeTimeoutMs);
          if (row?.id !== id || row?.organisationId !== checkedIdentity.organisationId || row?.action !== ONLINE_RADIO_DELIVERY_ACTION ||
              row?.entityType !== "Station" || row?.entityId !== checkedIdentity.stationId || canonical(row?.details ?? null) !== canonical(details)) throw fail("DELIVERY_EVENT_CONFLICT");
          committedState = nextState;
          return Object.freeze({ id, recorded: true, listenerProof: false, royaltyConfirmed: false });
        } catch (error) {
          // Never surface driver messages, SQL, arguments, or credentials.
          terminalError = error instanceof OnlineRadioDeliveryError ? error : fail("DELIVERY_WRITE_FAILED");
          throw terminalError;
        }
      }).finally(() => { pending -= 1; });
      seen.set(id, { fingerprint, promise });
      // Attach a rejection handler immediately; drain()/record() still expose failure.
      queue = promise.catch(() => {});
      return promise;
    },
    snapshot,
    async drain() { await queue; if (terminalError) throw terminalError; return snapshot(); }
  });
}
