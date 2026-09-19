import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { inspectTimedSequenceAuthority, inspectTimedSequenceItemAdmission } from "../lib/studio-timed-sequence-authority.mjs";

const start = new Date("2026-10-02T10:00:00Z");
const end = new Date(start.getTime() + 720_000);
const sequence = () => ({
  ready: true, reason: "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR", commandIssued: false, listenerVerified: false,
  capturedAt: start, startsAt: start, endsAt: end,
  organisationId: "org-1", channelId: "channel-1", playlistId: "playlist-1",
  scheduleId: "schedule-1", scheduleVersion: 2, programmeItemId: "programme-1", programmePriority: 50,
  items: [{ position: 0 }, { position: 1 }, { position: 2 }]
});
const candidate = () => ({
  sourceType: "PROGRAMME_SCHEDULE", sourceId: "programme-1",
  sourceRevision: "schedule-1:2:programme-1", organisationId: "org-1", channelId: "channel-1",
  priority: 850, available: true, validFrom: start, validUntil: end
});
const authority = () => ({
  complete: true, organisationId: "org-1", channelId: "channel-1", capturedAt: start,
  coversUntil: end, candidates: [candidate()], requiredInsertions: []
});
const inspect = (overrides = {}) => inspectTimedSequenceAuthority({ sequence: sequence(), authority: authority(), instant: start, ...overrides });

test("one matching published programme is consistent but never commands output", () => {
  assert.deepEqual(inspect(), { consistent: true, reason: "SEQUENCE_AUTHORITY_CONSISTENT_NOT_ON_AIR",
    sourceCommandAllowed: false, listenerVerified: false });
});

test("a competing source or required insertion blocks the isolated handoff", () => {
  assert.equal(inspect({ authority: { ...authority(), candidates: [candidate(), { ...candidate(), sourceId: "emergency", sourceType: "EMERGENCY_OVERRIDE" }] } }).reason,
    "SEQUENCE_COMPETING_SOURCE_NOT_ARBITRATED");
  assert.equal(inspect({ authority: { ...authority(), candidates: [] } }).reason, "SEQUENCE_COMPETING_SOURCE_NOT_ARBITRATED");
  assert.equal(inspect({ authority: { ...authority(), requiredInsertions: [{ scheduleItemId: "advert" }] } }).reason,
    "SEQUENCE_INSERTION_NOT_ARBITRATED");
});

test("stale, early and changed programme evidence fails closed", () => {
  assert.equal(inspect({ instant: new Date(start.getTime() - 1) }).reason, "SEQUENCE_START_BOUNDARY_UNAVAILABLE");
  assert.equal(inspect({ instant: new Date(start.getTime() + 1_000) }).reason, "SEQUENCE_START_BOUNDARY_UNAVAILABLE");
  assert.equal(inspect({ sequence: { ...sequence(), capturedAt: new Date(start.getTime() - 11_000) } }).reason, "SEQUENCE_AUTHORITY_PLAN_STALE");
  assert.equal(inspect({ authority: { ...authority(), capturedAt: new Date(start.getTime() - 11_000) } }).reason, "SEQUENCE_AUTHORITY_SNAPSHOT_INVALID");
  assert.equal(inspect({ authority: { ...authority(), coversUntil: new Date(end.getTime() - 1) } }).reason, "SEQUENCE_AUTHORITY_SNAPSHOT_INVALID");
  assert.equal(inspect({ authority: { ...authority(), channelId: "other-channel" } }).reason, "SEQUENCE_AUTHORITY_SNAPSHOT_INVALID");
  assert.equal(inspect({ authority: { ...authority(), candidates: [{ ...candidate(), sourceRevision: "schedule-1:1:programme-1" }] } }).reason,
    "SEQUENCE_PROGRAMME_AUTHORITY_MISMATCH");
  assert.equal(inspect({ authority: { ...authority(), candidates: [{ ...candidate(), priority: 700 }] } }).reason,
    "SEQUENCE_PROGRAMME_AUTHORITY_MISMATCH");
  assert.equal(inspect({ sequence: { ...sequence(), endsAt: new Date(end.getTime() + 11_000) },
    authority: { ...authority(), coversUntil: new Date(end.getTime() + 11_000) } }).reason,
    "SEQUENCE_PROGRAMME_AUTHORITY_MISMATCH");
  assert.equal(inspect({ sequence: { ...sequence(), commandIssued: true } }).reason, "SEQUENCE_AUTHORITY_PLAN_INVALID");
});

test("the existing worker cannot use this read-only check as a source switch", async () => {
  const worker = await readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /inspectTimedSequenceAuthority|studio-timed-sequence-authority|loadPublishedTimedChannelAuthority/);
  assert.equal(inspect().sourceCommandAllowed, false);
});

test("a later frozen item needs its exact boundary, original programme and current encoder lease", () => {
  const boundary = new Date(start.getTime() + 238_000);
  const frozen = { ...sequence(), version: 2, capturedAt: boundary,
    items: [{ position: 0, trackId: "a", startOffsetSeconds: 0 },
      { position: 1, trackId: "b", startOffsetSeconds: 238 }] };
  const currentAuthority = { ...authority(), capturedAt: boundary };
  const streamConfig = { outboundAutoDjEnabled: true, encoderLeaseOwner: "worker-1",
    encoderLeaseUntil: new Date(boundary.getTime() + 30_000) };
  const scope = { sequence: frozen, authority: currentAuthority, streamConfig,
    expectedVersion: 2, expectedTrackId: "b", position: 1, workerOwner: "worker-1", instant: boundary };
  assert.deepEqual(inspectTimedSequenceItemAdmission(scope), {
    admissible: true, reason: "SEQUENCE_ITEM_CONSISTENT_NOT_ON_AIR",
    sourceCommandAllowed: false, listenerVerified: false
  });
  const reason = (change) => inspectTimedSequenceItemAdmission({ ...scope, ...change }).reason;
  assert.equal(reason({ expectedVersion: 3 }), "SEQUENCE_ITEM_FROZEN_VERSION_MISMATCH");
  assert.equal(reason({ expectedTrackId: "a" }), "SEQUENCE_ITEM_FROZEN_VERSION_MISMATCH");
  assert.equal(reason({ instant: new Date(boundary.getTime() - 1) }), "SEQUENCE_ITEM_BOUNDARY_UNAVAILABLE");
  assert.equal(reason({ instant: new Date(boundary.getTime() + 1_000) }), "SEQUENCE_ITEM_BOUNDARY_UNAVAILABLE");
  assert.equal(reason({ authority: { ...currentAuthority, candidates: [] } }), "SEQUENCE_ITEM_COMPETING_SOURCE_NOT_ARBITRATED");
  assert.equal(reason({ authority: { ...currentAuthority, requiredInsertions: [{}] } }), "SEQUENCE_ITEM_INSERTION_NOT_ARBITRATED");
  assert.equal(reason({ authority: { ...currentAuthority, candidates: [{ ...candidate(), sourceRevision: "changed" }] } }), "SEQUENCE_ITEM_PROGRAMME_MISMATCH");
  assert.equal(reason({ streamConfig: { ...streamConfig, encoderLeaseOwner: "other-worker" } }), "SEQUENCE_ITEM_ENCODER_LEASE_UNAVAILABLE");
  assert.equal(reason({ streamConfig: { ...streamConfig, encoderLeaseUntil: boundary } }), "SEQUENCE_ITEM_ENCODER_LEASE_UNAVAILABLE");
  assert.equal(reason({ streamConfig: { ...streamConfig, outboundAutoDjEnabled: false } }), "SEQUENCE_ITEM_ENCODER_LEASE_UNAVAILABLE");
});
