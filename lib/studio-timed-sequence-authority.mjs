import { PLAYOUT_SOURCE_PRIORITIES } from "./playout-resolver.mjs";

const MAX_SNAPSHOT_AGE_MS = 10_000;
const START_BOUNDARY_MS = 1_000;

function date(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function denied(reason) {
  return { consistent: false, reason, sourceCommandAllowed: false, listenerVerified: false };
}

// Read-only consistency check at the start of an isolated timed programme.
// It is deliberately stricter than general source arbitration: until an
// output bridge can preempt, resume and recheck rights, *any* competing source
// or required insertion blocks the rehearsal handoff. A positive result is
// never a command or a play acknowledgement.
export function inspectTimedSequenceAuthority({ sequence, authority, instant = new Date() }) {
  const now = date(instant);
  const start = date(sequence?.startsAt);
  const end = date(sequence?.endsAt);
  const sequenceCapturedAt = date(sequence?.capturedAt);
  if (!now || sequence?.ready !== true || sequence.reason !== "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR" ||
      sequence.commandIssued !== false || sequence.listenerVerified !== false ||
      !sequence.organisationId || !sequence.channelId || !sequence.playlistId ||
      !sequence.scheduleId || !Number.isInteger(sequence.scheduleVersion) || sequence.scheduleVersion < 1 ||
      !sequence.programmeItemId || !Number.isInteger(sequence.programmePriority) ||
      sequence.programmePriority < 0 || sequence.programmePriority > 100 ||
      !Array.isArray(sequence.items) || !sequence.items.length ||
      !start || !end || end <= start || !sequenceCapturedAt) {
    return denied("SEQUENCE_AUTHORITY_PLAN_INVALID");
  }
  if (now < start || now.getTime() - start.getTime() >= START_BOUNDARY_MS) {
    return denied("SEQUENCE_START_BOUNDARY_UNAVAILABLE");
  }
  if (sequenceCapturedAt > now || now - sequenceCapturedAt > MAX_SNAPSHOT_AGE_MS) {
    return denied("SEQUENCE_AUTHORITY_PLAN_STALE");
  }
  const authorityCapturedAt = date(authority?.capturedAt);
  const coversUntil = date(authority?.coversUntil);
  if (authority?.complete !== true || authority.organisationId !== sequence.organisationId ||
      authority.channelId !== sequence.channelId || !authorityCapturedAt || authorityCapturedAt > now ||
      now - authorityCapturedAt > MAX_SNAPSHOT_AGE_MS || !coversUntil || coversUntil < end ||
      !Array.isArray(authority.candidates) || !Array.isArray(authority.requiredInsertions)) {
    return denied("SEQUENCE_AUTHORITY_SNAPSHOT_INVALID");
  }
  if (authority.requiredInsertions.length) return denied("SEQUENCE_INSERTION_NOT_ARBITRATED");
  if (authority.candidates.length !== 1) return denied("SEQUENCE_COMPETING_SOURCE_NOT_ARBITRATED");
  const candidate = authority.candidates[0];
  const candidateStart = date(candidate?.validFrom);
  const candidateEnd = date(candidate?.validUntil);
  if (candidate?.sourceType !== "PROGRAMME_SCHEDULE" ||
      candidate.sourceId !== sequence.programmeItemId ||
      candidate.sourceRevision !== `${sequence.scheduleId}:${sequence.scheduleVersion}:${sequence.programmeItemId}` ||
      candidate.organisationId !== sequence.organisationId || candidate.channelId !== sequence.channelId ||
      candidate.priority !== PLAYOUT_SOURCE_PRIORITIES.PROGRAMME_SCHEDULE + sequence.programmePriority ||
      candidate.available !== true || !candidateStart || candidateStart.getTime() !== start.getTime() ||
      !candidateEnd || candidateEnd < end) {
    return denied("SEQUENCE_PROGRAMME_AUTHORITY_MISMATCH");
  }
  return { consistent: true, reason: "SEQUENCE_AUTHORITY_CONSISTENT_NOT_ON_AIR",
    sourceCommandAllowed: false, listenerVerified: false };
}

function itemDenied(reason) {
  return { admissible: false, reason, sourceCommandAllowed: false, listenerVerified: false };
}

// A distinct later-track diagnostic: the programme began earlier, so its
// original start boundary cannot be used to admit this item. Every input must
// come from the same fresh repeatable-read snapshot at the item's own boundary.
export function inspectTimedSequenceItemAdmission({
  sequence, authority, streamConfig, expectedVersion, expectedTrackId,
  position, workerOwner, instant = new Date()
}) {
  const now = date(instant);
  const start = date(sequence?.startsAt);
  const end = date(sequence?.endsAt);
  const capturedAt = date(sequence?.capturedAt);
  if (!now || !start || !end || !capturedAt || end <= start ||
      sequence?.ready !== true || sequence.reason !== "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR" ||
      sequence.commandIssued !== false || sequence.listenerVerified !== false ||
      !sequence.organisationId || !sequence.channelId || !sequence.playlistId ||
      !sequence.scheduleId || !Number.isInteger(sequence.scheduleVersion) || sequence.scheduleVersion < 1 ||
      !sequence.programmeItemId || !Number.isInteger(sequence.programmePriority) ||
      sequence.programmePriority < 0 || sequence.programmePriority > 100 ||
      !Array.isArray(sequence.items) || !sequence.items.length ||
      !Number.isInteger(position) || position < 0 || position >= sequence.items.length ||
      !Number.isInteger(expectedVersion) || expectedVersion < 1 || !expectedTrackId || !workerOwner) {
    return itemDenied("SEQUENCE_ITEM_PLAN_INVALID");
  }
  if (sequence.version !== expectedVersion || sequence.items[position]?.position !== position ||
      sequence.items[position].trackId !== expectedTrackId ||
      !Number.isInteger(sequence.items[position].startOffsetSeconds) ||
      sequence.items[position].startOffsetSeconds < 0) {
    return itemDenied("SEQUENCE_ITEM_FROZEN_VERSION_MISMATCH");
  }
  const boundary = start.getTime() + sequence.items[position].startOffsetSeconds * 1000;
  if (now.getTime() < boundary || now.getTime() - boundary >= START_BOUNDARY_MS || now >= end) {
    return itemDenied("SEQUENCE_ITEM_BOUNDARY_UNAVAILABLE");
  }
  if (capturedAt > now || now - capturedAt > MAX_SNAPSHOT_AGE_MS) {
    return itemDenied("SEQUENCE_ITEM_SNAPSHOT_STALE");
  }
  const authorityCapturedAt = date(authority?.capturedAt);
  const coversUntil = date(authority?.coversUntil);
  if (authority?.complete !== true || authority.organisationId !== sequence.organisationId ||
      authority.channelId !== sequence.channelId || !authorityCapturedAt || authorityCapturedAt > now ||
      now - authorityCapturedAt > MAX_SNAPSHOT_AGE_MS || !coversUntil || coversUntil < end ||
      !Array.isArray(authority.candidates) || !Array.isArray(authority.requiredInsertions)) {
    return itemDenied("SEQUENCE_ITEM_AUTHORITY_INVALID");
  }
  if (authority.requiredInsertions.length) return itemDenied("SEQUENCE_ITEM_INSERTION_NOT_ARBITRATED");
  if (authority.candidates.length !== 1) return itemDenied("SEQUENCE_ITEM_COMPETING_SOURCE_NOT_ARBITRATED");
  const candidate = authority.candidates[0];
  const candidateStart = date(candidate?.validFrom);
  const candidateEnd = date(candidate?.validUntil);
  if (candidate?.sourceType !== "PROGRAMME_SCHEDULE" || candidate.sourceId !== sequence.programmeItemId ||
      candidate.sourceRevision !== `${sequence.scheduleId}:${sequence.scheduleVersion}:${sequence.programmeItemId}` ||
      candidate.organisationId !== sequence.organisationId || candidate.channelId !== sequence.channelId ||
      candidate.priority !== PLAYOUT_SOURCE_PRIORITIES.PROGRAMME_SCHEDULE + sequence.programmePriority ||
      candidate.available !== true || !candidateStart || candidateStart.getTime() !== start.getTime() ||
      !candidateEnd || candidateEnd < end) {
    return itemDenied("SEQUENCE_ITEM_PROGRAMME_MISMATCH");
  }
  const leaseUntil = date(streamConfig?.encoderLeaseUntil);
  if (streamConfig?.outboundAutoDjEnabled !== true || streamConfig.encoderLeaseOwner !== workerOwner ||
      !leaseUntil || leaseUntil <= now) {
    return itemDenied("SEQUENCE_ITEM_ENCODER_LEASE_UNAVAILABLE");
  }
  return { admissible: true, reason: "SEQUENCE_ITEM_CONSISTENT_NOT_ON_AIR",
    sourceCommandAllowed: false, listenerVerified: false };
}
