import { randomUUID } from "node:crypto";
import { catalogueTestOwnerSessionValid, loadCatalogueTestContext } from "./catalogue-test-service.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { continuousObservedPhase } from "./test-radio-continuous-phase.mjs";
import { TEST_RADIO_CONTINUOUS as P, continuousError, continuousSourceReady, continuousSourceFingerprint,
  continuousStationDecision, continuousEligibleTracks, signContinuousCommand, verifyContinuousCommand,
  continuousBudgetMonth, continuousChargedBytes } from "./test-radio-continuous-policy.mjs";

export const CONTINUOUS_CONTROL_ID = "test-radio-continuous-control-v1";
export const CONTINUOUS_OBSERVATION_ID = "test-radio-continuous-observation-v1";
const ENTITY = "TestRadioContinuous";
const trackInclude = { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }, distributorItems: { select: { id: true } } };
const budgetId = month => `test-radio-continuous-budget-${month}`;
const leaseValid = (config, owner, now) => config?.encoderLeaseOwner === owner && owner?.startsWith(P.leasePrefix) &&
  config.encoderLeaseUntil instanceof Date && config.encoderLeaseUntil > now;
function requireOwner(actorSession, now) {
  if (!catalogueTestOwnerSessionValid(actorSession, actorSession?.userId, now)) throw continuousError("CONTINUOUS_OWNER_REQUIRED");
}
async function control(db) { return (await db.auditLog.findUnique({ where: { id: CONTINUOUS_CONTROL_ID } }))?.details || null; }
function activeCommand(envelope, now, env) {
  const command = envelope?.command;
  if (!verifyContinuousCommand(envelope, env) || command.action !== "START" || command.kind !== P.kind ||
    command.stationId !== P.stationId || command.monthlyBudgetUsd !== P.monthlyBudgetUsd || command.publicExposureAccepted !== true ||
    command.bitrateKbps !== P.bitrateKbps || command.territory !== P.territory || command.catalogueLevel !== P.catalogueLevel ||
    !/^[a-f0-9-]{36}$/.test(command.id || "") || !Number.isSafeInteger(command.sequence) || command.sequence < 1 ||
    !Number.isFinite(Date.parse(command.issuedAt)) || Date.parse(command.issuedAt) > now.getTime()) return null;
  return command;
}
async function noConflictingTest(db) {
  const conflict = await db.onlineRadioCatalogueTest.findFirst({ where: { stationId: P.stationId, OR: [
    { status: { in: ["ARMED", "RUNNING"] } }, { endedReason: "CATALOGUE_TEST_STOP_UNCONFIRMED" },
    { events: { some: { kind: "TEST_ENDED", details: { path: ["stopConfirmed"], equals: false } } } },
  ] }, select: { id: true } });
  if (conflict) throw continuousError("CONTINUOUS_TEST_CONFLICT");
}
async function writeControl(tx, command, actorUserId, now, env) {
  let signature;
  try { signature = signContinuousCommand(command, env); }
  catch (error) {
    // A missing/rotated key must never prevent an authenticated emergency STOP.
    // An unsigned command cannot authorize START under activeCommand().
    if (command.action !== "STOP") throw error;
    signature = null;
  }
  const details = { command, signature };
  const data = { organisationId: command.organisationId, actorUserId, action: "TEST_RADIO_CONTINUOUS_CONTROL",
    entityType: ENTITY, entityId: P.stationId, details };
  await tx.auditLog.upsert({ where: { id: CONTINUOUS_CONTROL_ID }, create: { id: CONTINUOUS_CONTROL_ID, ...data }, update: data });
  await tx.auditLog.create({ data: { ...data, action: `TEST_RADIO_CONTINUOUS_${command.action}`, createdAt: now } });
}
async function candidates(db, context, now) {
  const tracks = await db.track.findMany({ where: { status: "READY", mediaAsset: { libraryType: "RUVANAS_CATALOGUE", organisationId: null } },
    include: trackInclude, orderBy: { id: "asc" }, take: P.maximumCandidates + 1 });
  return continuousEligibleTracks(tracks, { organisationId: context.station.organisationId, configuredGenres: context.configuredGenres, now });
}
async function authorize(db, { now, env, expectedGrantId }, withTracks) {
  const grant = activeCommand(await control(db), now, env);
  if (!grant || expectedGrantId && grant.id !== expectedGrantId) throw continuousError("CONTINUOUS_NOT_ENABLED");
  const actor = await db.user.findUnique({ where: { id: grant.actorUserId }, select: { id: true, role: true } });
  // The permanent owner command survives browser logout, not owner deletion or demotion.
  if (!actor || actor.role !== "SUPER_ADMIN") throw continuousError("CONTINUOUS_OWNER_REVOKED");
  const context = await loadCatalogueTestContext(db, now);
  const refusal = continuousStationDecision(context, now);
  if (refusal) throw continuousError(refusal);
  if (grant.organisationId !== context.station.organisationId || grant.sourceFingerprint !== continuousSourceFingerprint(context.station.streamConfig))
    throw continuousError("CONTINUOUS_SOURCE_CHANGED");
  await noConflictingTest(db);
  const tracks = withTracks ? await candidates(db, context, now) : undefined;
  if (withTracks && tracks.length < 2) throw continuousError("CONTINUOUS_NO_APPROVED_MUSIC");
  return { grant, source: context.station.streamConfig, station: context.station, configuredGenres: context.configuredGenres,
    serviceExpiresAt: context.serviceExpiresAt, ...(withTracks ? { tracks } : {}) };
}
export async function loadAuthorizedContinuousRadio(db, { now = new Date(), env = process.env, expectedGrantId } = {}) {
  return authorize(db, { now, env, expectedGrantId }, true);
}
export async function startContinuousRadio(db, { actorSession, publicExposureAccepted, monthlyBudgetUsd, now = new Date(), env = process.env } = {}) {
  requireOwner(actorSession, now);
  if (env.RUVANAS_TEST_RADIO_CONTINUOUS_ENABLED !== "true") throw continuousError("CONTINUOUS_START_DISABLED");
  if (publicExposureAccepted !== true || monthlyBudgetUsd !== P.monthlyBudgetUsd) throw continuousError("CONTINUOUS_APPROVAL_REQUIRED");
  return runSerializableTransaction(db, async tx => {
    const context = await loadCatalogueTestContext(tx, now);
    const refusal = continuousStationDecision(context, now);
    if (refusal) throw continuousError(refusal);
    await noConflictingTest(tx);
    if ((await candidates(tx, context, now)).length < 2) throw continuousError("CONTINUOUS_NO_APPROVED_MUSIC");
    const envelope = await control(tx), existing = activeCommand(envelope, now, env);
    if (existing) {
      if (existing.sourceFingerprint !== continuousSourceFingerprint(context.station.streamConfig)) throw continuousError("CONTINUOUS_SOURCE_CHANGED");
      return { grantId: existing.id, enabled: true };
    }
    const config = context.station.streamConfig;
    if (config.encoderLeaseOwner && config.encoderLeaseUntil instanceof Date && config.encoderLeaseUntil.getTime() + P.takeoverGraceSeconds * 1000 > now.getTime())
      throw continuousError("CONTINUOUS_WORKER_BUSY");
    const month = continuousBudgetMonth(now), usage = await tx.auditLog.findUnique({ where: { id: budgetId(month) } });
    if ((usage?.details?.reservedBytes || 0) >= P.monthlyReservedBytes) throw continuousError("CONTINUOUS_BUDGET_EXHAUSTED");
    const command = { kind: P.kind, action: "START", id: randomUUID(), sequence: (Number.isSafeInteger(envelope?.command?.sequence) ? envelope.command.sequence : 0) + 1,
      stationId: P.stationId, organisationId: context.station.organisationId, actorUserId: actorSession.userId,
      actorSessionId: actorSession.id, sourceFingerprint: continuousSourceFingerprint(config), issuedAt: now.toISOString(),
      publicExposureAccepted: true, monthlyBudgetUsd: P.monthlyBudgetUsd, bitrateKbps: P.bitrateKbps,
      territory: P.territory, catalogueLevel: P.catalogueLevel };
    await writeControl(tx, command, actorSession.userId, now, env);
    return { grantId: command.id, enabled: true };
  });
}
export async function stopContinuousRadio(db, { actorSession, now = new Date(), env = process.env } = {}) {
  requireOwner(actorSession, now);
  // STOP deliberately needs no usable source, tracks, entitlement or live worker.
  return runSerializableTransaction(db, async tx => {
    const previous = await control(tx);
    const station = await tx.station.findUnique({ where: { id: P.stationId }, select: { id: true, organisationId: true } });
    if (!station) throw continuousError("CONTINUOUS_STATION_REQUIRED");
    const command = { kind: P.kind, action: "STOP", id: randomUUID(), stationId: P.stationId, organisationId: station.organisationId,
      actorUserId: actorSession.userId, issuedAt: now.toISOString(),
      sequence: (Number.isSafeInteger(previous?.command?.sequence) ? previous.command.sequence : 0) + 1 };
    await writeControl(tx, command, actorSession.userId, now, env);
    return { enabled: false, status: "STOP_REQUESTED" };
  });
}
export async function claimContinuousRadioLease(db, { grantId, workerId, now = new Date(), env = process.env } = {}) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(workerId || "")) throw continuousError("CONTINUOUS_WORKER_ID_INVALID");
  const leaseOwner = `${P.leasePrefix}${workerId}`;
  return runSerializableTransaction(db, async tx => {
    const { source } = await authorize(tx, { now, env, expectedGrantId: grantId }, false);
    const leaseUntil = new Date(now.getTime() + P.leaseSeconds * 1000);
    const acquired = await tx.stationStreamConfig.updateMany({ where: { stationId: P.stationId, outboundAutoDjEnabled: false,
      OR: [{ encoderLeaseOwner: null }, { encoderLeaseUntil: { lt: new Date(now.getTime() - P.takeoverGraceSeconds * 1000) } },
        { encoderLeaseOwner: leaseOwner, encoderLeaseUntil: { gt: now } }] },
      data: { encoderLeaseOwner: leaseOwner, encoderLeaseUntil: leaseUntil, lastHeartbeatAt: now } });
    if (!source || acquired.count !== 1) throw continuousError("CONTINUOUS_WORKER_BUSY");
    return { leaseOwner, leaseUntil };
  });
}
export async function renewContinuousRadioLease(db, { grantId, leaseOwner, now = new Date(), env = process.env } = {}) {
  return runSerializableTransaction(db, async tx => {
    const { source } = await authorize(tx, { now, env, expectedGrantId: grantId }, false);
    if (!leaseValid(source, leaseOwner, now)) throw continuousError("CONTINUOUS_LEASE_LOST");
    const updated = await tx.stationStreamConfig.updateMany({ where: { stationId: P.stationId, encoderLeaseOwner: leaseOwner,
      encoderLeaseUntil: { gt: now }, outboundAutoDjEnabled: false },
      data: { encoderLeaseUntil: new Date(now.getTime() + P.leaseSeconds * 1000), lastHeartbeatAt: now } });
    if (updated.count !== 1) throw continuousError("CONTINUOUS_LEASE_LOST");
    return true;
  });
}
export async function releaseContinuousRadioLease(db, { leaseOwner, now = new Date(), stopConfirmed = true } = {}) {
  if (!leaseOwner?.startsWith(P.leasePrefix)) throw continuousError("CONTINUOUS_LEASE_LOST");
  const updated = await db.stationStreamConfig.updateMany({ where: { stationId: P.stationId, encoderLeaseOwner: leaseOwner },
    data: stopConfirmed ? { encoderLeaseOwner: null, encoderLeaseUntil: null, sourceConnectionStatus: "DISCONNECTED", lastHeartbeatAt: now } :
      { lastError: "CONTINUOUS_STOP_UNCONFIRMED", lastHeartbeatAt: now } });
  return updated.count === 1;
}
export async function reserveContinuousRadioBytes(db, { grantId, leaseOwner, bytes, now = new Date(), env = process.env } = {}) {
  const charged = continuousChargedBytes(bytes), monthKey = continuousBudgetMonth(now);
  return runSerializableTransaction(db, async tx => {
    const { grant, source } = await authorize(tx, { now, env, expectedGrantId: grantId }, false);
    if (!leaseValid(source, leaseOwner, now)) throw continuousError("CONTINUOUS_LEASE_LOST");
    const id = budgetId(monthKey), previous = await tx.auditLog.findUnique({ where: { id } });
    const used = previous?.details?.reservedBytes ?? 0;
    if (!Number.isSafeInteger(used) || used < 0 || used + charged > P.monthlyReservedBytes) throw continuousError("CONTINUOUS_BUDGET_EXHAUSTED");
    const details = { monthKey, reservedBytes: used + charged, monthlyBudgetUsd: 15, wireMultiplier: P.wireMultiplier,
      computeReservedUsd: 7, otherReservedUsd: P.monthlyOtherReserveUsd, lastReservationAt: now.toISOString() };
    const data = { action: "TEST_RADIO_CONTINUOUS_BUDGET", entityType: ENTITY, entityId: P.stationId,
      organisationId: grant.organisationId, details };
    await tx.auditLog.upsert({ where: { id }, create: { id, ...data }, update: data });
    // Unused reservations are never refunded. Crashes/restarts cannot erase cost.
    return { reservedBytes: bytes, monthKey, remainingBytes: Math.floor((P.monthlyReservedBytes - used - charged) / P.wireMultiplier) };
  });
}
export async function recordContinuousRadioObservation(db, { grantId, leaseOwner, state, trackId = null, audioBytesSent = 0,
  reasonCode = null, phase = "UNKNOWN", occurrenceId = null, scheduleRevision = null, now = new Date(), env = process.env } = {}) {
  if (!["STARTING", "STREAMING", "DISCONNECTED", "ERROR"].includes(state) || !Number.isSafeInteger(audioBytesSent) || audioBytesSent < 0)
    throw continuousError("CONTINUOUS_OBSERVATION_INVALID");
  if (reasonCode !== null && (state !== "ERROR" || typeof reasonCode !== "string" || !/^CONTINUOUS_[A-Z_]{1,80}$/.test(reasonCode)))
    throw continuousError("CONTINUOUS_OBSERVATION_INVALID");
  return runSerializableTransaction(db, async tx => {
    const config = await tx.stationStreamConfig.findUnique({ where: { stationId: P.stationId } });
    if (!leaseValid(config, leaseOwner, now)) throw continuousError("CONTINUOUS_LEASE_LOST");
    let track = null, programmeEvidence = { phase: "UNKNOWN", programme: null };
    if (state === "STREAMING") {
      if (audioBytesSent < 1) throw continuousError("CONTINUOUS_AUDIO_UNCONFIRMED");
      const active = await authorize(tx, { now, env, expectedGrantId: grantId }, true);
      track = active.tracks.find(item => item.track.id === trackId)?.track;
      if (!track) throw continuousError("CONTINUOUS_TRACK_REVOKED");
      if (phase === "RANDOM") programmeEvidence = continuousObservedPhase({ phase }, null);
      else if (phase === "SCHEDULED") {
        // A queued frame observation can arrive just after an owner disables or
        // replaces a plan. Hide the stale programme label; do not stop approved
        // random music because a presentation-only label is no longer current.
        try {
          const { loadAuthorizedContinuousSchedule } = await import("./test-radio-continuous-schedule-service.mjs");
          const schedule = await loadAuthorizedContinuousSchedule(tx, { authorized: active, now, env });
          programmeEvidence = continuousObservedPhase({ phase, occurrenceId, scheduleRevision, trackId }, schedule);
        } catch { programmeEvidence = { phase: "UNKNOWN", programme: null }; }
      }
    }
    const previous = await tx.auditLog.findUnique({ where: { id: CONTINUOUS_OBSERVATION_ID } });
    const sameTrack = previous?.details?.grantId === grantId && previous.details.leaseOwner === leaseOwner && previous.details.trackId === trackId;
    const details = { grantId, leaseOwner, state, trackId: track?.id || null, title: track?.title || null, artist: track?.artist || null,
      audioBytesSent, reasonCode, ...programmeEvidence, observedAt: now.toISOString(), sourceStartedAt: track ? (sameTrack ? previous.details.sourceStartedAt : now.toISOString()) : null };
    const data = { action: "TEST_RADIO_CONTINUOUS_OBSERVATION", entityType: ENTITY, entityId: P.stationId, details };
    await tx.auditLog.upsert({ where: { id: CONTINUOUS_OBSERVATION_ID }, create: { id: CONTINUOUS_OBSERVATION_ID, ...data }, update: data });
    await tx.stationStreamConfig.updateMany({ where: { stationId: P.stationId, encoderLeaseOwner: leaseOwner }, data: {
      sourceConnectionStatus: state === "STREAMING" ? "CONNECTED" : "DISCONNECTED", lastHeartbeatAt: now,
      ...(state === "STREAMING" ? { lastConnectedAt: now } : {}) } });
    return true;
  });
}
export async function continuousRadioDashboard(db, { actorSession, now, env = process.env, clock = () => new Date() } = {}) {
  const startedAt = now || clock();
  requireOwner(actorSession, startedAt);
  const context = await loadCatalogueTestContext(db, startedAt);
  const envelope = await control(db);
  const config = context.station.streamConfig;
  const observation = (await db.auditLog.findUnique({ where: { id: CONTINUOUS_OBSERVATION_ID } }))?.details;
  // A source write may be committed during these reads. Judge freshness against
  // the completed observation, not the request start, without inventing titles.
  const observedNow = now || clock();
  const grant = activeCommand(envelope, observedNow, env), enabled = Boolean(grant);
  const workerReady = Boolean(config?.encoderLeaseOwner?.startsWith(P.leasePrefix) && config.encoderLeaseUntil instanceof Date && config.encoderLeaseUntil > observedNow);
  const observedAt = Date.parse(observation?.observedAt || "");
  const fresh = Number.isFinite(observedAt) && observedAt <= observedNow.getTime() && observedNow.getTime() - observedAt < P.observationFreshnessMs;
  const sourceReady = continuousSourceReady(config), decision = continuousStationDecision(context, observedNow);
  const grantMatched = Boolean(enabled && observation?.grantId === grant.id);
  const matched = Boolean(grantMatched && observation.leaseOwner === config?.encoderLeaseOwner);
  // Confirmed failures remain visible after the worker releases its lease.
  // They never authorize a player; a fresh STARTING observation clears them.
  const durableError = Boolean(grantMatched && observation.state === "ERROR" && Number.isFinite(observedAt) && observedAt <= observedNow.getTime());
  const reasonCode = durableError && /^CONTINUOUS_[A-Z_]{1,80}$/.test(observation.reasonCode || "") ? observation.reasonCode : null;
  const sourceChanged = enabled && grant.sourceFingerprint !== continuousSourceFingerprint(config);
  const streaming = Boolean(matched && workerReady && fresh && observation.state === "STREAMING" && observation.audioBytesSent > 0 && sourceReady && !decision && !sourceChanged);
  const attentionRequired = Boolean(decision || sourceChanged || config?.lastError === "CONTINUOUS_STOP_UNCONFIRMED" || durableError);
  const status = !enabled ? (workerReady ? "STOPPING" : "STOPPED") : attentionRequired ? "NEEDS_ATTENTION" : streaming ? "STREAMING" : workerReady ? "STARTING" : "WAITING_FOR_WORKER";
  const expiresInMs = streaming ? Math.max(0, Math.min(P.observationFreshnessMs - (observedNow.getTime() - observedAt), config.encoderLeaseUntil.getTime() - observedNow.getTime())) : 0;
  const usage = (await db.auditLog.findUnique({ where: { id: budgetId(continuousBudgetMonth(observedNow)) } }))?.details;
  return { stationId: P.stationId, enabled, sourceReady,
    serviceExpiresAt: context.serviceExpiresAt instanceof Date && Number.isFinite(context.serviceExpiresAt.getTime()) ? context.serviceExpiresAt.toISOString() : null,
    startAllowed: env.RUVANAS_TEST_RADIO_CONTINUOUS_ENABLED === "true" && !enabled && !workerReady && !attentionRequired,
    attentionRequired, status, reasonCode,
    label: status === "NEEDS_ATTENTION" && reasonCode === "CONTINUOUS_BUDGET_EXHAUSTED" ? "Monthly Test Radio budget reached; playback stopped." :
      status === "NEEDS_ATTENTION" && durableError ? "Playback stopped and needs attention." : status.replaceAll("_", " "),
    worker: { ready: workerReady, checkedAt: observedNow.toISOString(), leaseUntil: workerReady ? config.encoderLeaseUntil.toISOString() : null,
      state: durableError ? "ERROR" : matched && fresh ? observation.state : "UNKNOWN" },
    listening: { enabled: streaming, listenerUrl: streaming ? P.listenerUrl : null, expiresInMs,
      phase: streaming && ["RANDOM", "SCHEDULED"].includes(observation.phase) ? observation.phase : "UNKNOWN",
      programme: streaming && observation.phase === "SCHEDULED" ? observation.programme || null : null,
      track: streaming && observation.title && observation.artist ? { title: observation.title, artist: observation.artist,
        sourceStartedAt: observation.sourceStartedAt, expiresInMs } : null },
    budget: { monthlyUsd: P.monthlyBudgetUsd, estimatedMonthlyUsd: P.estimatedMonthlyUsd,
      reservedBytes: Number.isSafeInteger(usage?.reservedBytes) ? usage.reservedBytes : 0, maximumReservedBytes: P.monthlyReservedBytes,
      monthKey: continuousBudgetMonth(observedNow), note: "Estimate, not a provider bill. Includes one existing worker and reserved outbound usage; no new services." } };
}
