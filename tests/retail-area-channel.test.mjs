import assert from "node:assert/strict";
import test from "node:test";
import { prepareRetailAreaChannel } from "../lib/retail-area-channel.mjs";

const instant = new Date("2026-09-23T12:00:00.000Z");
const args = { organisationId: "org-a", actorUserId: "owner-a", zoneId: "zone-a", streamLimit: 1, instant };

function fakeDatabase({ zone = { id: "zone-a", name: "Whole Area", location: { name: "Daniel's Mall" } }, assignments = [], activeChannels = 0, existing = null, unused = [] } = {}) {
  const state = { assignments: [...assignments], activeChannels, existing, unused, createdChannels: [], audit: [] };
  const tx = {
    zone: { findFirst: async () => zone },
    channelAssignment: {
      findMany: async ({ where }) => state.assignments.filter((item) => item.zoneId === where.zoneId && (!item.activeTo || item.activeTo > instant)),
      count: async ({ where }) => state.assignments.filter((item) => item.channelId === where.channelId && (!item.activeTo || item.activeTo > instant)).length,
      findUnique: async ({ where }) => state.assignments.find((item) => item.channelId === where.channelId_zoneId.channelId && item.zoneId === where.channelId_zoneId.zoneId) || null,
      create: async ({ data }) => { state.assignments.push({ id: "assignment-a", ...data, activeTo: null, channel: { organisationId: "org-a", status: "ACTIVE", musicRightsUse: "RETAIL_RADIO" } }); },
      update: async ({ where, data }) => { Object.assign(state.assignments.find((item) => item.id === where.id), data); }
    },
    channel: {
      findUnique: async () => state.existing,
      findMany: async () => state.unused,
      count: async () => state.activeChannels,
      create: async ({ data }) => { const channel = { id: "channel-a", ...data }; state.createdChannels.push(channel); state.existing = channel; state.activeChannels += 1; return channel; },
      update: async ({ where, data }) => { Object.assign(state.existing, data); return { id: where.id }; }
    },
    auditLog: { create: async ({ data }) => { state.audit.push(data); } }
  };
  return { state, $transaction: async (operation) => operation(tx) };
}

test("Retail Save may prepare one owned channel once and reuse it on retry", async () => {
  const database = fakeDatabase();
  const first = await prepareRetailAreaChannel(database, args);
  const retry = await prepareRetailAreaChannel(database, args);
  assert.deepEqual(first, { ok: true, channelId: "channel-a", prepared: true });
  assert.deepEqual(retry, { ok: true, channelId: "channel-a", prepared: false });
  assert.equal(database.state.createdChannels.length, 1);
  assert.equal(database.state.assignments.length, 1);
  assert.equal(database.state.audit.length, 1);
  assert.equal(database.state.createdChannels[0].musicRightsUse, "RETAIL_RADIO");
  assert.equal(database.state.createdChannels[0].stationId, undefined);
});

test("Retail channel preparation rejects missing areas and exhausted plan slots", async () => {
  assert.equal((await prepareRetailAreaChannel(fakeDatabase({ zone: null }), args)).status, 404);
  const full = fakeDatabase({ activeChannels: 1 });
  const result = await prepareRetailAreaChannel(full, args);
  assert.equal(result.status, 409);
  assert.equal(full.state.createdChannels.length, 0);
  assert.equal(full.state.assignments.length, 0);
});

test("Retail Save reuses a single unused channel without consuming another plan slot", async () => {
  const database = fakeDatabase({ activeChannels: 1, unused: [{ id: "spare-retail" }] });
  const result = await prepareRetailAreaChannel(database, args);
  assert.deepEqual(result, { ok: true, channelId: "spare-retail", prepared: true });
  assert.equal(database.state.createdChannels.length, 0);
  assert.equal(database.state.assignments[0].channelId, "spare-retail");
  assert.equal(database.state.audit[0].details.reusedChannel, true);
  const ambiguous = fakeDatabase({ activeChannels: 1, unused: [{ id: "spare-one" }, { id: "spare-two" }] });
  assert.equal((await prepareRetailAreaChannel(ambiguous, args)).status, 409);
  assert.equal(ambiguous.state.assignments.length, 0);
});

test("Retail channel preparation never replaces an assigned or future channel", async () => {
  const assignment = { id: "other-assignment", channelId: "other-channel", zoneId: "zone-a", activeFrom: instant, activeTo: null, channel: { organisationId: "org-a", status: "ACTIVE", musicRightsUse: "ONLINE_RADIO" } };
  const assigned = fakeDatabase({ assignments: [assignment] });
  assert.equal((await prepareRetailAreaChannel(assigned, args)).status, 409);
  assert.equal(assigned.state.createdChannels.length, 0);
  const future = fakeDatabase({ assignments: [{ ...assignment, activeFrom: new Date("2026-09-24T12:00:00.000Z"), channel: { ...assignment.channel, musicRightsUse: "RETAIL_RADIO" } }] });
  assert.equal((await prepareRetailAreaChannel(future, args)).status, 409);
  assert.equal(future.state.createdChannels.length, 0);
});
