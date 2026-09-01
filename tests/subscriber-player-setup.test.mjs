import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageSubscriberPlayers,
  createSubscriberPlayer,
  normalizeSubscriberPlayerInput,
  subscriberPlayerAllowance
} from "../lib/subscriber-player-setup.mjs";

function subscription(limit = 1, status = "ACTIVE") {
  return {
    status,
    plan: {
      active: true,
      code: "SHOP",
      stationLimit: limit,
      storageLimitGb: 5,
      listenerLimit: 100,
      maxBitrateKbps: 320
    },
    billingContract: null
  };
}

function memoryDatabase({ limit = 1, configured = 0, zoneOrganisationId = "organisation-1" } = {}) {
  const players = Array.from({ length: configured }, (_, index) => ({ id: `player-${index + 1}`, organisationId: "organisation-1", status: "ONLINE" }));
  const audits = [];
  const tx = {
    subscription: { async findUnique() { return subscription(limit); } },
    zone: {
      async findFirst({ where }) {
        return where.id === "zone-1" && where.location.organisationId === zoneOrganisationId
          ? { id: "zone-1", locationId: "location-1" }
          : null;
      }
    },
    player: {
      async count({ where }) { return players.filter((player) => player.organisationId === where.organisationId && player.status !== "DISABLED").length; },
      async create({ data }) { const player = { id: `player-${players.length + 1}`, status: "PENDING_ENROLMENT", ...data }; players.push(player); return player; }
    },
    auditLog: { async create({ data }) { audits.push(data); return data; } }
  };
  return {
    players,
    audits,
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, "Serializable");
      return operation(tx);
    }
  };
}

test("only organisation owners and managers can manage subscriber players", () => {
  assert.equal(canManageSubscriberPlayers("OWNER"), true);
  assert.equal(canManageSubscriberPlayers("MANAGER"), true);
  assert.equal(canManageSubscriberPlayers("CONTENT_EDITOR"), false);
  assert.equal(canManageSubscriberPlayers("VIEWER"), false);
});

test("player setup input is bounded and requires a zone", () => {
  assert.deepEqual(normalizeSubscriberPlayerInput({ name: " Main shop ", zoneId: " zone-1 " }), { name: "Main shop", zoneId: "zone-1" });
  assert.throws(() => normalizeSubscriberPlayerInput({ name: "x", zoneId: "zone-1" }), /at least two/);
  assert.throws(() => normalizeSubscriberPlayerInput({ name: "Main shop", zoneId: "" }), /Choose a location/);
});

test("legacy organisations retain one controlled setup slot", () => {
  assert.deepEqual(subscriberPlayerAllowance(null), { enabled: true, limit: 1, legacy: true });
});

test("an owner can create a tenant-zone player inside the subscribed allowance", async () => {
  const database = memoryDatabase({ limit: 2, configured: 1 });
  const instant = new Date("2026-09-01T17:00:00.000Z");
  const result = await createSubscriberPlayer(database, {
    organisationId: "organisation-1",
    actorUserId: "user-1",
    input: { name: "Main shop", zoneId: "zone-1" },
    enrolmentTokenHash: "hashed-one-time-code",
    enrolmentExpiresAt: new Date(instant.getTime() + 86_400_000),
    instant
  });
  assert.equal(result.ok, true);
  assert.deepEqual({ configured: result.configured, limit: result.limit }, { configured: 2, limit: 2 });
  assert.equal(database.audits[0].action, "SUBSCRIBER_PLAYER_CREATED");
  assert.equal(database.audits[0].organisationId, "organisation-1");
});

test("configured-player capacity and tenant boundaries are enforced", async () => {
  const instant = new Date("2026-09-01T17:00:00.000Z");
  const full = await createSubscriberPlayer(memoryDatabase({ limit: 1, configured: 1 }), {
    organisationId: "organisation-1",
    actorUserId: "user-1",
    input: { name: "Second shop", zoneId: "zone-1" },
    enrolmentTokenHash: "hashed-code",
    enrolmentExpiresAt: new Date(instant.getTime() + 86_400_000),
    instant
  });
  assert.equal(full.ok, false);
  assert.equal(full.status, 409);

  const crossTenant = await createSubscriberPlayer(memoryDatabase({ limit: 2, zoneOrganisationId: "other-organisation" }), {
    organisationId: "organisation-1",
    actorUserId: "user-1",
    input: { name: "Foreign zone", zoneId: "zone-1" },
    enrolmentTokenHash: "hashed-code",
    enrolmentExpiresAt: new Date(instant.getTime() + 86_400_000),
    instant
  });
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.status, 400);
});
