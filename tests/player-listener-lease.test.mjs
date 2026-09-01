import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPlayerListenerToken,
  claimPlayerListenerLease,
  isPlayerListenerTokenActive,
  normalizePlayerInstanceId,
  releasePlayerListenerLease,
  verifyPlayerListenerToken
} from "../lib/player-listener-lease.mjs";

const secret = "stage-15b-player-listener-test-secret";
const firstInstance = "11111111-1111-4111-8111-111111111111";
const secondInstance = "22222222-2222-4222-8222-222222222222";

function player(streamLimit = 1) {
  return {
    id: "player-1",
    organisationId: "organisation-1",
    organisation: {
      subscription: {
        status: "ACTIVE",
        plan: {
          active: true,
          code: "SHOP",
          stationLimit: streamLimit,
          storageLimitGb: 2,
          listenerLimit: 100,
          maxBitrateKbps: 128
        }
      }
    }
  };
}

function memoryDatabase() {
  const leases = [];
  const listenerModel = {
    async deleteMany({ where }) {
      const before = leases.length;
      for (let index = leases.length - 1; index >= 0; index -= 1) {
        const lease = leases[index];
        const expired = where.expiresAt?.lte && lease.expiresAt <= where.expiresAt.lte;
        const exact = where.playerId && lease.playerId === where.playerId &&
          lease.organisationId === where.organisationId && lease.instanceHash === where.instanceHash;
        if ((where.expiresAt && lease.organisationId === where.organisationId && expired) || exact) leases.splice(index, 1);
      }
      return { count: before - leases.length };
    },
    async findMany({ where }) {
      return leases
        .filter((lease) => lease.organisationId === where.organisationId && lease.expiresAt > where.expiresAt.gt)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    },
    async create({ data }) {
      const lease = { id: `lease-${leases.length + 1}`, createdAt: new Date(), ...data };
      leases.push(lease);
      return lease;
    },
    async update({ where, data }) {
      const lease = leases.find((item) => item.id === where.id);
      Object.assign(lease, data);
      return lease;
    },
    async delete({ where }) {
      const index = leases.findIndex((item) => item.id === where.id);
      return leases.splice(index, 1)[0];
    },
    async findUnique({ where }) {
      const key = where.playerId_instanceHash;
      return leases.find((lease) => lease.playerId === key.playerId && lease.instanceHash === key.instanceHash) || null;
    }
  };
  return {
    leases,
    playerListenerLease: listenerModel,
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, "Serializable");
      return operation({ playerListenerLease: listenerModel });
    }
  };
}

test("player instance IDs are strict and media listener tokens are signed", () => {
  assert.equal(normalizePlayerInstanceId(` ${firstInstance.toUpperCase()} `), firstInstance);
  assert.equal(normalizePlayerInstanceId("shared-link"), null);
  assert.equal(appendPlayerListenerToken("/api/player/media/track-1", "signed.token"), "/api/player/media/track-1?listener=signed.token");
});

test("a one-stream tier renews its holder and refuses a second active browser", async () => {
  const database = memoryDatabase();
  const currentPlayer = player(1);
  const instant = new Date("2026-09-01T12:00:00.000Z");
  const first = await claimPlayerListenerLease(database, { player: currentPlayer, instanceId: firstInstance, instant, secret });
  assert.equal(first.ok, true);
  assert.deepEqual({ active: first.activeCount, limit: first.limit }, { active: 1, limit: 1 });
  assert.ok(verifyPlayerListenerToken({ playerId: currentPlayer.id, token: first.listenerToken, instant }, secret));
  assert.equal(await isPlayerListenerTokenActive(database, { player: currentPlayer, token: first.listenerToken, instant, secret }), true);

  const renewed = await claimPlayerListenerLease(database, {
    player: currentPlayer,
    instanceId: firstInstance,
    instant: new Date(instant.getTime() + 30_000),
    secret
  });
  assert.equal(renewed.ok, true);
  assert.equal(database.leases.length, 1);

  const denied = await claimPlayerListenerLease(database, {
    player: currentPlayer,
    instanceId: secondInstance,
    instant: new Date(instant.getTime() + 31_000),
    secret
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 429);
  assert.equal(denied.code, "PLAYER_STREAM_LIMIT_REACHED");

  assert.equal(await releasePlayerListenerLease(database, { player: currentPlayer, instanceId: firstInstance, secret }), true);
  const replacement = await claimPlayerListenerLease(database, {
    player: currentPlayer,
    instanceId: secondInstance,
    instant: new Date(instant.getTime() + 32_000),
    secret
  });
  assert.equal(replacement.ok, true);
});

test("expired leases free capacity automatically", async () => {
  const database = memoryDatabase();
  const currentPlayer = player(1);
  const instant = new Date("2026-09-01T12:00:00.000Z");
  await claimPlayerListenerLease(database, { player: currentPlayer, instanceId: firstInstance, instant, secret });
  const afterExpiry = await claimPlayerListenerLease(database, {
    player: currentPlayer,
    instanceId: secondInstance,
    instant: new Date(instant.getTime() + 91_000),
    secret
  });
  assert.equal(afterExpiry.ok, true);
  assert.equal(database.leases.length, 1);
});
