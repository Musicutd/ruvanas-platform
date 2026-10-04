import assert from "node:assert/strict";
import test from "node:test";
import { schoolMediaIntentIsCurrent } from "../lib/school-player-media.mjs";
import { compileSchoolRadioPlayout } from "../lib/school-radio.mjs";

test("a recent School rundown item survives a bucket transition but not withdrawal or revision changes", async () => {
  const start = new Date("2026-10-04T12:00:00.000Z");
  const now = new Date(start.getTime() + 5 * 60_000 + 10_000);
  const player = { id: "player-1", organisationId: "school-1", zoneId: "zone-1",
    organisation: { subscription: { status: "ACTIVE", plan: { active: true, schoolRadioEnabled: true, stationLimit: 1, storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128 } } },
    zone: { locationId: "campus-1" } };
  const media = (id) => ({ id, organisationId: player.organisationId, status: "READY",
    durationSeconds: 300 });
  const first = { id: "item-1", type: "INTERVIEW", position: 0, label: "First segment",
    sourceMediaAsset: media("first-media"), estimatedDurationMs: 300_000 };
  const second = { id: "item-2", type: "INTERVIEW", position: 1, label: "Second segment",
    sourceMediaAsset: media("second-media"), estimatedDurationMs: 60_000 };
  const slot = { id: "slot-1", organisationId: player.organisationId, zoneId: player.zoneId,
    locationId: null, status: "APPROVED", revision: 1, startsAt: start,
    endsAt: new Date(start.getTime() + 20 * 60_000), announcement: null,
    episode: { id: "episode-1", organisationId: player.organisationId, status: "APPROVED",
      title: "Approved show", rundown: { id: "rundown-1", status: "APPROVED", revision: 1,
        approvedRevision: 1, items: [first, second] } } };
  let rundownSafe = true;
  const database = {
    schoolBroadcastSlot: { findFirst: async ({ where }) =>
      slot.status === where.status && slot.revision === where.revision &&
      slot.endsAt > where.endsAt.gt && where.OR.some((target) =>
        target.zoneId === slot.zoneId || target.locationId === slot.locationId) ? slot : null },
    schoolRundown: { findFirst: async ({ where }) =>
      rundownSafe && where.id === slot.episode.rundown.id ? { id: where.id } : null }
  };
  const firstInsertion = compileSchoolRadioPlayout({ slots: [slot], player, instant: start }).insertions[0];
  assert.equal(firstInsertion.schoolRundownItemId, first.id);
  const secondInsertion = compileSchoolRadioPlayout({ slots: [slot], player,
    instant: new Date(start.getTime() + 5 * 60_000) }).insertions[0];
  assert.equal(secondInsertion.schoolRundownItemId, second.id);
  const intent = { ...firstInsertion };
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), true,
    "the first item remains playable while the second item occupies the current manifest bucket");

  slot.episode.status = "ARCHIVED";
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), false);
  slot.episode.status = "APPROVED";
  slot.episode.rundown.status = "DRAFT";
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), false);
  slot.episode.rundown.status = "APPROVED";
  slot.episode.rundown.revision = 2;
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), false);
  slot.episode.rundown.revision = 1;
  first.sourceMediaAsset = media("replacement-media");
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), false);
  first.sourceMediaAsset = media("first-media");
  rundownSafe = false;
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), false);
  rundownSafe = true;
  slot.status = "CANCELLED";
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), false);
  slot.status = "APPROVED";
  player.organisation.subscription.status = "CANCELLED";
  assert.equal(await schoolMediaIntentIsCurrent(database, { player, intent, instant: now }), false);
});
