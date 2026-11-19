import { runSerializableTransaction } from "./transaction-retry.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "./retail-subscriber-access.mjs";
import { loadRetailTestPlayerByTokenHash } from "./retail-test-player-access.mjs";

const ENTITY = "RetailPlayerStreamEvidence";
const key = id => `retail-player-stream:${id}`;
export const RETAIL_STREAM_EVIDENCE_FRESH_MS = 45000;
const iso = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const exactPlayer = player => player?.organisationId === ORG && player?.subscriberTestStream?.stationId === STATION &&
  player.subscriberTestStream.kind === "RETAIL_SHARED_STREAM" && Boolean(iso(player.enrolledAt));
export function normalizeRetailStreamEvidence(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).some(key => !["state", "positionSeconds", "observedAt"].includes(key)) ||
    !["PLAYING", "PAUSED", "FAILED"].includes(input.state) ||
    typeof input.positionSeconds !== "number" || !Number.isFinite(input.positionSeconds) || input.positionSeconds < 0 || input.positionSeconds > 31536000 ||
    typeof input.observedAt !== "string" || !Number.isFinite(Date.parse(input.observedAt)) ||
    Math.abs(now.getTime() - Date.parse(input.observedAt)) > 30000) return null;
  return { state: input.state, positionSeconds: input.positionSeconds, observedAt: new Date(input.observedAt).toISOString() };
}
export async function recordRetailStreamEvidence(db, { player, input, now = new Date() }) {
  const report = normalizeRetailStreamEvidence(input, now);
  if (!exactPlayer(player) || !report) return null;
  return runSerializableTransaction(db, async tx => {
    const prior = await tx.auditLog.findUnique({ where: { id: key(player.id) } });
    const previous = readRetailStreamEvidence(prior, player, now);
    if (previous && report.observedAt <= previous.observedAt) return previous;
    const progressObserved = report.state === "PLAYING" && previous?.state === "PLAYING" &&
      report.positionSeconds > previous.positionSeconds + 0.05;
    const details = { ...report, receivedAt: now.toISOString(), enrolledAt: iso(player.enrolledAt),
      stationId: STATION, channelId: player.subscriberTestStream.channelId,
      progressObserved: Boolean(progressObserved), evidenceType: "DEVICE_REPORTED_STREAM_ONLY" };
    const data = { organisationId: ORG, action: "RETAIL_PLAYER_STREAM_OBSERVED", entityType: ENTITY,
      entityId: player.id, details, createdAt: now };
    await tx.auditLog.upsert({ where: { id: key(player.id) }, create: { id: key(player.id), ...data }, update: data });
    return details;
  });
}
export function readRetailStreamEvidence(row, player, now = new Date()) {
  const data = row?.details;
  if (!exactPlayer(player) || row?.id !== key(player.id) || row.organisationId !== ORG || row.entityType !== ENTITY ||
    row.entityId !== player.id || row.action !== "RETAIL_PLAYER_STREAM_OBSERVED" || data?.stationId !== STATION ||
    data.channelId !== player.subscriberTestStream.channelId || data.enrolledAt !== iso(player.enrolledAt) ||
    data.evidenceType !== "DEVICE_REPORTED_STREAM_ONLY" || !normalizeRetailStreamEvidence(data && {
      state: data.state, positionSeconds: data.positionSeconds, observedAt: data.observedAt
    }, new Date(data.receivedAt)) || !Number.isFinite(Date.parse(data.receivedAt)) ||
    Date.parse(data.receivedAt) > now.getTime() || now.getTime() - Date.parse(data.receivedAt) > RETAIL_STREAM_EVIDENCE_FRESH_MS) return null;
  return { state: data.state, positionSeconds: data.positionSeconds, observedAt: data.observedAt,
    receivedAt: data.receivedAt, progressObserved: data.progressObserved === true, evidenceType: "DEVICE_REPORTED_STREAM_ONLY" };
}
/** Readiness is a device report, not proof of any particular song or sound from speakers. */
export async function annotateRetailTestPlayerReadiness(db, players, { now = new Date(), env = process.env } = {}) {
  return Promise.all(players.map(async player => {
    if (player.organisationId !== ORG || !player.sessionTokenHash) return player;
    const authorized = await loadRetailTestPlayerByTokenHash(db, player.sessionTokenHash, { now, env });
    if (!authorized || authorized.id !== player.id) return player;
    const row = await db.auditLog.findUnique({ where: { id: key(player.id) } });
    return { ...player, subscriberTestStream: authorized.subscriberTestStream,
      zone: { ...player.zone, channelAssignments: authorized.zone.channelAssignments },
      subscriberTestStreamEvidence: readRetailStreamEvidence(row, authorized, now) };
  }));
}
