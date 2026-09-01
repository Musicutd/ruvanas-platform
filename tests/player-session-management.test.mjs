import assert from "node:assert/strict";
import test from "node:test";
import {
  canManagePlayerSessions,
  listActivePlayerSessions,
  revokePlayerSession
} from "../lib/player-session-management.mjs";

function memoryDatabase() {
  const leases = [
    {
      id: "lease-active",
      organisationId: "organisation-a",
      playerId: "player-a",
      lastSeenAt: new Date("2026-09-01T12:00:30.000Z"),
      expiresAt: new Date("2026-09-01T12:02:00.000Z"),
      revokedAt: null,
      player: { id: "player-a", name: "Main shop", status: "ONLINE", zone: { id: "zone-a", name: "Front", location: { id: "location-a", name: "Valletta" } } }
    },
    {
      id: "lease-other-tenant",
      organisationId: "organisation-b",
      playerId: "player-b",
      lastSeenAt: new Date("2026-09-01T12:00:40.000Z"),
      expiresAt: new Date("2026-09-01T12:02:00.000Z"),
      revokedAt: null,
      player: { id: "player-b", name: "Other shop", status: "ONLINE", zone: { id: "zone-b", name: "Floor", location: { id: "location-b", name: "Sliema" } } }
    }
  ];
  const audits = [];
  const playerListenerLease = {
    async findMany({ where }) {
      return leases.filter((lease) => lease.organisationId === where.organisationId && lease.revokedAt == null && lease.expiresAt > where.expiresAt.gt);
    },
    async findFirst({ where }) {
      return leases.find((lease) => lease.id === where.id && lease.organisationId === where.organisationId && lease.revokedAt == null && lease.expiresAt > where.expiresAt.gt) || null;
    },
    async update({ where, data }) {
      const lease = leases.find((item) => item.id === where.id);
      Object.assign(lease, data);
      return lease;
    }
  };
  const auditLog = { async create({ data }) { audits.push(data); return data; } };
  return {
    leases,
    audits,
    playerListenerLease,
    auditLog,
    async $transaction(operation) { return operation({ playerListenerLease, auditLog }); }
  };
}

test("owners and managers can control sessions while other client roles remain view-only", () => {
  assert.equal(canManagePlayerSessions("OWNER"), true);
  assert.equal(canManagePlayerSessions("MANAGER"), true);
  assert.equal(canManagePlayerSessions("CONTENT_EDITOR"), false);
  assert.equal(canManagePlayerSessions("VIEWER"), false);
});

test("active session listing and revocation stay inside the active organisation", async () => {
  const database = memoryDatabase();
  const instant = new Date("2026-09-01T12:01:00.000Z");
  const sessions = await listActivePlayerSessions(database, { organisationId: "organisation-a", instant });
  assert.deepEqual(sessions.map((item) => item.id), ["lease-active"]);

  const crossTenant = await revokePlayerSession(database, {
    organisationId: "organisation-a",
    leaseId: "lease-other-tenant",
    actorUserId: "owner-a",
    instant
  });
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.status, 404);

  const revoked = await revokePlayerSession(database, {
    organisationId: "organisation-a",
    leaseId: "lease-active",
    actorUserId: "owner-a",
    instant
  });
  assert.equal(revoked.ok, true);
  assert.equal(database.leases[0].revokedAt.toISOString(), instant.toISOString());
  assert.equal(database.leases[0].expiresAt.toISOString(), "2026-09-01T12:02:30.000Z");
  assert.equal(database.audits.length, 1);
  assert.equal(database.audits[0].action, "PLAYER_LISTENER_SESSION_REVOKED");
  assert.equal(database.audits[0].organisationId, "organisation-a");
  assert.equal(database.audits[0].actorUserId, "owner-a");
});
