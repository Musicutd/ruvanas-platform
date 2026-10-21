import assert from "node:assert/strict";
import test from "node:test";
import { createOnlineRadioDeliveryLedger, deliveryEventId, reconcileDeliveryEvents, senderUsageRows, validateDeliveryEvent,
  ONLINE_RADIO_DELIVERY_ACTION, SOURCE_DELIVERY_SECONDS_DECIMAL_PLACES } from "../lib/online-radio-delivery-ledger.mjs";

const identity = { organisationId: "org-1", stationId: "station-1", destinationId: "stream-config-1", sessionId: "runtime-session-1" };
const start = (extra = {}) => ({ type: "STARTED", segmentSequence: 1, trackId: "track-1", mediaAssetId: "asset-1", eventAt: "2026-10-21T12:00:00Z", ...extra });
const audio = (extra = {}) => ({ ...start(), type: "AUDIO_SENT", eventAt: "2026-10-21T12:00:01Z", transmittedBytes: 100, observationBasis: "SOURCE_WRITE_CALLBACK", ...extra });
const end = (extra = {}) => ({ ...start(), type: "ENDED", eventAt: "2026-10-21T12:03:00Z", reasonCode: "SOURCE_FILE_ENDED", ...extra });
const full = observation => ({ ...identity, ...observation });
function fixture(options = {}) {
  const rows = new Map(), writes = [];
  const prisma = { auditLog: { async upsert(args) {
    writes.push(structuredClone(args));
    if (!rows.has(args.where.id)) rows.set(args.where.id, structuredClone(args.create));
    return structuredClone(rows.get(args.where.id));
  } } };
  return { rows, writes, prisma, ledger: createOnlineRadioDeliveryLedger({ prisma, identity, ...options }) };
}
const rejectsCode = (promise, code) => assert.rejects(promise, { code });
const throwsCode = (operation, code) => assert.throws(operation, { code });

test("events contain only bounded opaque identities and explicit observations", () => {
  const checked = validateDeliveryEvent(full(start()));
  assert.equal(checked.transmittedSeconds, null);
  assert.equal(checked.transmittedBytes, null);
  assert.equal(checked.observationBasis, null);
  assert.equal(checked.eventAt, "2026-10-21T12:00:00.000Z");
  assert.ok(Object.isFrozen(checked));
  for (const extra of [{ storageKey: "private/music.mp3" }, { password: "secret" }, { filePath: "/tmp/music" }, { durationSeconds: 180 }, { listenerCount: 1 }]) {
    throwsCode(() => validateDeliveryEvent(full(start(extra))), "DELIVERY_EVENT_INVALID");
  }
  throwsCode(() => validateDeliveryEvent({ ...full(start()), destinationId: "https://source:password@host/stream" }), "DELIVERY_IDENTITY_INVALID");
  throwsCode(() => validateDeliveryEvent(full(start({ trackId: "a/private/path" }))), "DELIVERY_TRACK_IDENTITY_INVALID");
});

test("amounts require trusted source callback semantics, never asset length or elapsed time", () => {
  for (const amounts of [{ transmittedBytes: 10 }, { transmittedSeconds: 1 }, { transmittedBytes: 0 }]) {
    throwsCode(() => validateDeliveryEvent(full(start(amounts))), "DELIVERY_OBSERVATION_REQUIRED");
  }
  for (const amounts of [{ transmittedBytes: -1 }, { transmittedBytes: 1.2 }, { transmittedSeconds: Infinity }, { transmittedSeconds: 86401 }, { transmittedBytes: 1024 ** 4 + 1 }]) {
    throwsCode(() => validateDeliveryEvent(full(start({ ...amounts, observationBasis: "SOURCE_WRITE_CALLBACK" }))), "DELIVERY_COUNTER_INVALID");
  }
  throwsCode(() => validateDeliveryEvent(full(start({ observationBasis: "ASSET_METADATA" }))), "DELIVERY_OBSERVATION_INVALID");
  assert.equal(validateDeliveryEvent(full(audio({ transmittedBytes: 1000 }))).transmittedBytes, 1000);
  throwsCode(() => validateDeliveryEvent(full(start({ transmittedBytes: 1, observationBasis: "SOURCE_WRITE_CALLBACK" }))), "DELIVERY_START_COUNTERS_FORBIDDEN");
  throwsCode(() => validateDeliveryEvent(full(audio({ transmittedBytes: 0 }))), "DELIVERY_FIRST_AUDIO_INVALID");
  throwsCode(() => validateDeliveryEvent(full(audio({ transmittedSeconds: 0 }))), "DELIVERY_FIRST_AUDIO_INVALID");
  throwsCode(() => validateDeliveryEvent(full(audio({ observationBasis: "ENCODER_OUTPUT_CALLBACK" }))), "DELIVERY_FIRST_AUDIO_INVALID");
});

test("invalid states, timestamps, arbitrary reasons and phases fail closed", () => {
  throwsCode(() => validateDeliveryEvent(full(start({ type: "PLAYED" }))), "DELIVERY_SEGMENT_INVALID");
  throwsCode(() => validateDeliveryEvent(full(start({ segmentSequence: 0 }))), "DELIVERY_SEGMENT_INVALID");
  throwsCode(() => validateDeliveryEvent(full(start({ eventAt: "invalid" }))), "DELIVERY_TIMESTAMP_INVALID");
  throwsCode(() => validateDeliveryEvent(full(start({ reasonCode: "SOURCE_FILE_ENDED" }))), "DELIVERY_REASON_INVALID");
  throwsCode(() => validateDeliveryEvent(full(end({ reasonCode: "password secret" }))), "DELIVERY_REASON_INVALID");
  throwsCode(() => validateDeliveryEvent(full(end({ reasonCode: undefined }))), "DELIVERY_REASON_INVALID");
});

test("reconciliation requires ordered starts and terminals matching the exact session and media", () => {
  const events = [full(start()), full(end())];
  const state = reconcileDeliveryEvents(events);
  assert.equal(state.lastSequence, 1);
  assert.equal(state.endedSegments, 1);
  assert.equal(state.eventsCount, 2);
  assert.equal(state.activeSegment, null);
  assert.equal(state.observedTransmittedSeconds, 0);
  assert.equal(state.segmentsWithSeconds, 0);
  assert.equal(state.listenerProof, false);
  assert.equal(state.royaltyConfirmed, false);
  throwsCode(() => reconcileDeliveryEvents([full(end())]), "DELIVERY_SEGMENT_ORDER_INVALID");
  throwsCode(() => reconcileDeliveryEvents([full(start({ segmentSequence: 2 }))]), "DELIVERY_SEGMENT_ORDER_INVALID");
  throwsCode(() => reconcileDeliveryEvents([full(start()), full(start({ segmentSequence: 2 }))]), "DELIVERY_SEGMENT_ORDER_INVALID");
  throwsCode(() => reconcileDeliveryEvents([full(start()), full(end({ trackId: "track-2" }))]), "DELIVERY_SEGMENT_ORDER_INVALID");
  throwsCode(() => reconcileDeliveryEvents([full(start()), { ...full(end()), sessionId: "other-session" }]), "DELIVERY_SESSION_MISMATCH");
  throwsCode(() => reconcileDeliveryEvents([full(start()), full(end({ eventAt: "2026-10-21T11:00:00Z" }))]), "DELIVERY_TIMESTAMP_REGRESSION");
});

test("interruption and failure retain only observed counters without claiming completion or listener proof", () => {
  const observationBasis = "SOURCE_WRITE_CALLBACK";
  const state = reconcileDeliveryEvents([
    full(start()),
    full(audio({ transmittedSeconds: 0.1 })),
    full(end({ type: "INTERRUPTED", reasonCode: "SCHEDULE_TAKEOVER", transmittedSeconds: 12.3, transmittedBytes: 200, observationBasis })),
    full(start({ segmentSequence: 2, eventAt: "2026-10-21T12:03:01Z" })),
    full(audio({ segmentSequence: 2, eventAt: "2026-10-21T12:03:02Z" })),
    full(end({ segmentSequence: 2, type: "FAILED", eventAt: "2026-10-21T12:03:03Z", reasonCode: "SOURCE_DISCONNECTED", transmittedBytes: 200, observationBasis }))
  ]);
  assert.equal(state.interruptedSegments, 1);
  assert.equal(state.failedSegments, 1);
  assert.equal(state.endedSegments, 0);
  assert.equal(state.observedTransmittedSeconds, 12.3);
  assert.equal(state.observedTransmittedBytes, 400);
  assert.equal(state.segmentsWithSeconds, 1);
  assert.equal(state.segmentsWithBytes, 2);
  assert.equal(state.listenerProof, false);
});

test("counter regression and changed source measurement bases are rejected", () => {
  const started = full(start()), observed = full(audio({ transmittedBytes: 200 }));
  throwsCode(() => reconcileDeliveryEvents([started, observed, full(end({ transmittedBytes: 100, observationBasis: "SOURCE_WRITE_CALLBACK" }))]), "DELIVERY_COUNTER_REGRESSION");
  throwsCode(() => reconcileDeliveryEvents([started, observed, full(end({ transmittedBytes: 300, observationBasis: "ENCODER_OUTPUT_CALLBACK" }))]), "DELIVERY_OBSERVATION_CHANGED");
  throwsCode(() => reconcileDeliveryEvents([started, full(end({ transmittedBytes: 300, observationBasis: "SOURCE_WRITE_CALLBACK" }))]), "DELIVERY_FIRST_AUDIO_MISSING");
});

test("deterministic event IDs deduplicate retries but reject conflicting terminal outcomes", () => {
  const started = full(start()), ended = full(end());
  assert.equal(deliveryEventId(ended), deliveryEventId(full(end({ type: "FAILED", reasonCode: "SOURCE_ENCODER_FAILED" }))));
  assert.notEqual(deliveryEventId(started), deliveryEventId(ended));
  assert.notEqual(deliveryEventId(started), deliveryEventId({ ...started, sessionId: "runtime-session-2" }));
  assert.equal(reconcileDeliveryEvents([started, started, ended, ended]).eventsCount, 2);
  throwsCode(() => reconcileDeliveryEvents([started, ended, full(end({ type: "INTERRUPTED", reasonCode: "SHUTDOWN" }))]), "DELIVERY_EVENT_CONFLICT");
});

test("durable helper serializes immutable AuditLog records only and deduplicates concurrent retries", async () => {
  const f = fixture();
  const first = f.ledger.record(start());
  const duplicate = f.ledger.record(start());
  assert.equal(first, duplicate);
  const observed = f.ledger.record(audio());
  const last = f.ledger.record(end({ transmittedBytes: 12800, observationBasis: "SOURCE_WRITE_CALLBACK" }));
  await Promise.all([first, duplicate, observed, last]);
  assert.equal(f.writes.length, 3);
  assert.equal(f.writes[0].create.action, ONLINE_RADIO_DELIVERY_ACTION);
  assert.deepEqual(f.writes[0].update, {});
  assert.equal(f.writes[0].create.entityType, "Station");
  assert.equal(f.writes[0].create.entityId, identity.stationId);
  assert.equal(f.writes[2].create.details.event.transmittedBytes, 12800);
  assert.equal(f.writes[1].create.details.evidenceKind, "SOURCE_DELIVERY_DIAGNOSTIC");
  assert.equal(f.writes[1].create.details.listenerProof, false);
  assert.equal(f.writes[1].create.details.royaltyConfirmed, false);
  const state = await f.ledger.drain();
  assert.equal(state.endedSegments, 1);
  assert.equal(state.pendingEvents, 0);
  const snapshot = f.ledger.snapshot(); snapshot.identity.stationId = "modified";
  assert.equal(f.ledger.snapshot().identity.stationId, identity.stationId);
});

test("ledger rejects identity overrides, invalid sequencing and conflict before another write", async () => {
  const f = fixture();
  await rejectsCode(f.ledger.record({ ...start(), stationId: "other" }), "DELIVERY_EVENT_IDENTITY_OVERRIDE");
  await rejectsCode(f.ledger.record(end()), "DELIVERY_SEGMENT_ORDER_INVALID");
  assert.equal(f.writes.length, 0);
  await f.ledger.record(start());
  await rejectsCode(f.ledger.record(start({ eventAt: "2026-10-21T12:00:01Z" })), "DELIVERY_EVENT_CONFLICT");
  assert.equal(f.writes.length, 1);
});

test("a previously recorded id is accepted only when every immutable audit field matches", async () => {
  const f = fixture();
  await f.ledger.record(start());
  const replay = createOnlineRadioDeliveryLedger({ prisma: f.prisma, identity });
  await replay.record(start());
  assert.equal(f.rows.size, 1);
  const conflict = createOnlineRadioDeliveryLedger({ prisma: f.prisma, identity });
  await rejectsCode(conflict.record(start({ eventAt: "2026-10-21T12:00:01Z" })), "DELIVERY_EVENT_CONFLICT");
  await rejectsCode(conflict.record(end()), "DELIVERY_EVENT_CONFLICT");
});

test("write errors are sanitized and permanently halt that ledger", async () => {
  let calls = 0;
  const ledger = createOnlineRadioDeliveryLedger({ identity, prisma: { auditLog: { async upsert() {
    calls += 1; throw new Error("database credentials and private path must never escape");
  } } } });
  await rejectsCode(ledger.record(start()), "DELIVERY_WRITE_FAILED");
  await rejectsCode(ledger.record(end()), "DELIVERY_WRITE_FAILED");
  await rejectsCode(ledger.drain(), "DELIVERY_WRITE_FAILED");
  assert.equal(calls, 1);
  assert.equal(ledger.snapshot().failed, true);
  assert.equal(ledger.snapshot().eventsCount, 0);
});

test("a timed-out write halts progress even when its underlying query completes later", async () => {
  let complete, calls = 0;
  const ledger = createOnlineRadioDeliveryLedger({ identity, writeTimeoutMs: 10, prisma: { auditLog: { upsert(args) {
    calls += 1; return new Promise(resolve => { complete = () => resolve(args.create); });
  } } } });
  await rejectsCode(ledger.record(start()), "DELIVERY_WRITE_TIMEOUT");
  await rejectsCode(ledger.record(end()), "DELIVERY_WRITE_TIMEOUT");
  complete(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(ledger.snapshot().eventsCount, 0);
  assert.equal(ledger.snapshot().failed, true);
});

test("bounded queues reject overload without silently dropping a record", async () => {
  let complete;
  const ledger = createOnlineRadioDeliveryLedger({ identity, maxPending: 1, prisma: { auditLog: { upsert(args) {
    return new Promise(resolve => { complete = () => resolve(args.create); });
  } } } });
  const started = ledger.record(start());
  await rejectsCode(ledger.record(end()), "DELIVERY_QUEUE_FULL");
  await new Promise(resolve => setImmediate(resolve));
  complete(); await started;
  const ended = ledger.record(end());
  await new Promise(resolve => setImmediate(resolve)); complete(); await ended;
  assert.equal((await ledger.drain()).endedSegments, 1);
});

test("bounded event count and constructor limits cannot be bypassed", async () => {
  const f = fixture({ maxEvents: 1 });
  await f.ledger.record(start());
  await rejectsCode(f.ledger.record(end()), "DELIVERY_EVENT_LIMIT");
  for (const options of [{ maxPending: 0 }, { maxPending: 65 }, { maxEvents: 10001 }, { writeTimeoutMs: 10001 }, { identity: { ...identity, password: "hidden" } }]) {
    assert.throws(() => fixture(options));
  }
  throwsCode(() => reconcileDeliveryEvents(new Array(10001)), "DELIVERY_EVENT_LIMIT");
});

test("source usage groups verified sessions by exact track, media and destination without double-counting retries", () => {
  const terminal = full(end({ transmittedBytes: 2000, transmittedSeconds: 0.052244897959183675, observationBasis: "SOURCE_WRITE_CALLBACK" }));
  const secondIdentity = { ...identity, sessionId: "runtime-session-2" };
  const secondStart = { ...full(start()), ...secondIdentity };
  const secondEnd = { ...terminal, ...secondIdentity, type: "INTERRUPTED", reasonCode: "SCHEDULE_TAKEOVER", transmittedBytes: 500, transmittedSeconds: 0.026122448979591838 };
  const rows = senderUsageRows([full(start()), secondStart, full(audio()), { ...full(audio()), ...secondIdentity }, terminal, terminal, secondEnd]);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.startedSegments, 2);
  assert.equal(row.audioObservedSegments, 2);
  assert.equal(row.endedSegments, 1);
  assert.equal(row.interruptedSegments, 1);
  assert.equal(row.failedSegments, 0);
  assert.equal(row.sessionCount, 2);
  assert.equal(row.unresolvedSegments, 0);
  assert.equal(row.observedTransmittedBytes, 2500);
  assert.equal(row.observedTransmittedSeconds, validateDeliveryEvent(terminal).transmittedSeconds + validateDeliveryEvent(secondEnd).transmittedSeconds);
  assert.deepEqual(row.observationBases, ["SOURCE_WRITE_CALLBACK"]);
  assert.equal(row.evidenceKind, "SOURCE_DELIVERY_DIAGNOSTIC");
  assert.equal(row.measurementMeaning, "SOURCE_OUTPUT_CALLBACK_NOT_REMOTE_PLAYBACK");
  assert.equal(row.listenerProof, false);
  assert.equal(row.royaltyConfirmed, false);
});

test("usage reports unknown amounts explicitly and does not promote started-only evidence", () => {
  const started = full(start()), observed = full(audio());
  const [unobserved] = senderUsageRows([started]);
  assert.equal(unobserved.observedTransmittedBytes, null);
  const [open] = senderUsageRows([started, observed]);
  assert.equal(open.unresolvedSegments, 1);
  assert.equal(open.unknownSegments, 1);
  assert.equal(open.sourceCompletionStatus, "UNKNOWN");
  assert.equal(open.observedTransmittedBytes, 100);
  assert.equal(open.observedTransmittedSeconds, null);
  assert.equal(open.lowerBoundOnly, true);
  const [closed] = senderUsageRows([started, observed, full(end({ type: "FAILED", reasonCode: "SOURCE_DISCONNECTED" }))]);
  assert.equal(closed.failedSegments, 1);
  assert.equal(closed.observedTransmittedBytes, 100);
  assert.equal(closed.segmentsWithoutByteMeasurement, 0);
  assert.equal(closed.segmentsWithoutSecondMeasurement, 1);
});

test("usage never merges distinct destinations or media and validates all session order first", () => {
  const secondIdentity = { ...identity, sessionId: "runtime-session-2", destinationId: "stream-config-2" };
  const secondStart = { ...full(start()), ...secondIdentity, mediaAssetId: "asset-2" };
  const secondEnd = { ...full(end()), ...secondIdentity, mediaAssetId: "asset-2" };
  assert.equal(senderUsageRows([full(start()), secondStart, full(end()), secondEnd]).length, 2);
  throwsCode(() => senderUsageRows([full(end())]), "DELIVERY_SEGMENT_ORDER_INVALID");
  throwsCode(() => senderUsageRows([full(start()), full(end()), full(end({ type: "FAILED", reasonCode: "SOURCE_DISCONNECTED" }))]), "DELIVERY_EVENT_CONFLICT");
  throwsCode(() => senderUsageRows(new Array(10001)), "DELIVERY_EVENT_LIMIT");
  assert.deepEqual(senderUsageRows([]), []);
});

test("first source-write phase survives a missing terminal as unknown with a measured lower bound", () => {
  const events = [full(start()), full(audio({ transmittedBytes: 418, transmittedSeconds: 1152 / 44100 }))];
  const state = reconcileDeliveryEvents([...events, events[1]]);
  assert.equal(state.eventsCount, 2);
  assert.equal(state.audioObservedSegments, 1);
  assert.equal(state.endedSegments, 0);
  assert.equal(state.observedTransmittedBytes, 418);
  assert.equal(state.activeSegment.completionStatus, "UNKNOWN");
  assert.equal(state.activeSegment.firstAudioObserved, true);
  assert.equal(state.listenerProof, false);
  const [row] = senderUsageRows(events);
  assert.equal(row.sourceCompletionStatus, "UNKNOWN");
  assert.equal(row.unknownSegments, 1);
  assert.equal(row.observedTransmittedBytes, 418);
  assert.equal(row.lowerBoundOnly, true);
  throwsCode(() => reconcileDeliveryEvents([...events, full(audio({ transmittedBytes: 419 }))]), "DELIVERY_EVENT_CONFLICT");
  throwsCode(() => reconcileDeliveryEvents([full(audio())]), "DELIVERY_SEGMENT_ORDER_INVALID");
});

test("measured seconds have a deterministic pre-persistence precision, while byte counts remain exact", () => {
  assert.equal(SOURCE_DELIVERY_SECONDS_DECIMAL_PLACES, 6);
  const checked = validateDeliveryEvent(full(audio({ transmittedBytes: 417, transmittedSeconds: 1152 / 44100 })));
  assert.equal(checked.transmittedSeconds, 0.026122);
  assert.equal(checked.transmittedBytes, 417);
  assert.deepEqual(validateDeliveryEvent(checked), checked);
  const ended = validateDeliveryEvent(full(end({ transmittedBytes: 834, transmittedSeconds: 2304 / 44100, observationBasis: "SOURCE_WRITE_CALLBACK" })));
  assert.equal(ended.transmittedSeconds, 0.052245);
  throwsCode(() => validateDeliveryEvent(full(audio({ transmittedBytes: 417.1, transmittedSeconds: 1152 / 44100 }))), "DELIVERY_COUNTER_INVALID");
});

test("strict durable equality survives an independent JSON number roundtrip without accepting changed measurements", async () => {
  const f = fixture(), original = f.prisma.auditLog.upsert;
  f.prisma.auditLog.upsert = async args => {
    const row = await original(args);
    // Models a separate driver's JSON float parse/stringify boundary; the old
    // repeating frame fraction changed its final digit at this boundary.
    const seconds = row.details.event.transmittedSeconds;
    if (seconds !== null) row.details.event.transmittedSeconds = Number(seconds.toPrecision(16));
    return JSON.parse(JSON.stringify(row));
  };
  await f.ledger.record(start());
  const firstAudio = audio({ transmittedBytes: 417, transmittedSeconds: 1152 / 44100 });
  await f.ledger.record(firstAudio);
  await f.ledger.record(firstAudio);
  await f.ledger.record(end({ transmittedBytes: 834, transmittedSeconds: 2304 / 44100, observationBasis: "SOURCE_WRITE_CALLBACK" }));
  assert.equal(f.writes.length, 3);
  assert.equal(f.writes[1].create.details.event.transmittedSeconds, 0.026122);
  assert.equal((await f.ledger.drain()).observedTransmittedSeconds, 0.052245);
  for (const field of ["transmittedBytes", "transmittedSeconds"]) {
    const corrupt = fixture(), upsert = corrupt.prisma.auditLog.upsert;
    corrupt.prisma.auditLog.upsert = async args => {
      const row = await upsert(args);
      if (row.details.event.type === "AUDIO_SENT") row.details.event[field] += field === "transmittedBytes" ? 1 : 0.000001;
      return row;
    };
    await corrupt.ledger.record(start());
    await rejectsCode(corrupt.ledger.record(firstAudio), "DELIVERY_EVENT_CONFLICT");
  }
});
