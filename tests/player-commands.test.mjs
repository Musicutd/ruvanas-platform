import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  canAcknowledgePlayerCommand,
  normalizePlayerCommandAcknowledgement,
  normalizePlayerCommandKind,
  playerCommandExpiry,
  replacementPlayerName
} from "../lib/player-commands.mjs";
import {
  acknowledgePlayerCommand,
  deliverNextPlayerCommand,
  expirePlayerCommands,
  transitionPlayerLifecycle
} from "../lib/player-command-service.js";

test("only allow-listed, non-disruptive player commands are accepted", () => {
  assert.equal(normalizePlayerCommandKind(" refresh_manifest "), "REFRESH_MANIFEST");
  assert.throws(() => normalizePlayerCommandKind("RESTART"), /approved player diagnostic/);
  assert.throws(() => normalizePlayerCommandKind("CHANGE_VOLUME"), /approved player diagnostic/);
});

test("player commands use bounded five-to-sixty-minute expiry", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  assert.equal(playerCommandExpiry(now, 1).toISOString(), "2026-08-29T12:05:00.000Z");
  assert.equal(playerCommandExpiry(now, 90).toISOString(), "2026-08-29T13:00:00.000Z");
});

test("acknowledgements retain bounded operational evidence only", () => {
  assert.deepEqual(normalizePlayerCommandAcknowledgement({
    outcome: "succeeded",
    message: " Refreshed ",
    details: { appVersion: " web-11b ", manifestVersion: "rev-8", sourceStatus: "connected", studentName: "must not be retained" }
  }), {
    status: "ACKNOWLEDGED",
    resultCode: "SUCCEEDED",
    resultMessage: "Refreshed",
    resultDetails: { appVersion: "web-11b", manifestVersion: "rev-8", sourceStatus: "CONNECTED" }
  });
});

test("commands can be acknowledged only once and before expiry", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  assert.deepEqual(canAcknowledgePlayerCommand({ status: "DELIVERED", expiresAt: "2026-08-29T12:01:00.000Z" }, now), { ok: true });
  assert.deepEqual(canAcknowledgePlayerCommand({ status: "ACKNOWLEDGED", expiresAt: "2026-08-29T12:01:00.000Z" }, now), { ok: false, reason: "NOT_DELIVERED" });
  assert.deepEqual(canAcknowledgePlayerCommand({ status: "DELIVERED", expiresAt: now }, now), { ok: false, reason: "EXPIRED" });
});

test("replacement names are bounded and default clearly", () => {
  assert.equal(replacementPlayerName("Reception", ""), "Reception replacement");
  assert.equal(replacementPlayerName("Reception", "New reception device"), "New reception device");
  assert.equal(replacementPlayerName("Reception", "x".repeat(200)).length, 120);
});

test("database command delivery, acknowledgement, expiry, and replacement preserve evidence", { skip: process.env.RUN_DATABASE_TESTS !== "1" }, async () => {
  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  const suffix = randomUUID();
  const now = new Date("2026-08-29T12:00:00.000Z");
  let organisationId;
  let userId;
  try {
    const user = await database.user.create({
      data: { email: `player-commands-${suffix}@example.invalid`, passwordHash: "not-used", role: "SUPER_ADMIN" }
    });
    userId = user.id;
    const organisation = await database.organisation.create({ data: { name: `Player commands ${suffix}`, slug: `player-commands-${suffix}` } });
    organisationId = organisation.id;
    const location = await database.location.create({ data: { organisationId, name: "Command location", slug: "command-location", status: "ACTIVE" } });
    const zone = await database.zone.create({ data: { locationId: location.id, name: "Command zone", slug: "command-zone" } });
    const player = await database.player.create({
      data: { organisationId, zoneId: zone.id, name: "Command player", status: "ONLINE", sessionTokenHash: `session-${suffix}` }
    });
    const command = await database.playerCommand.create({
      data: { organisationId, playerId: player.id, requestedById: userId, kind: "COLLECT_DIAGNOSTICS", requestedAt: now, expiresAt: new Date(now.getTime() + 600_000) }
    });
    assert.equal((await deliverNextPlayerCommand(database, player.id, { now })).id, command.id);
    assert.equal(await deliverNextPlayerCommand(database, player.id, { now }), null);
    const acknowledgement = await acknowledgePlayerCommand(database, {
      playerId: player.id,
      commandId: command.id,
      acknowledgement: { outcome: "SUCCEEDED", message: "Healthy", details: { appVersion: "11b", sourceStatus: "CONNECTED", privateDetail: "discard" } },
      now: new Date(now.getTime() + 1_000)
    });
    assert.equal(acknowledgement.ok, true);
    assert.equal(acknowledgement.command.status, "ACKNOWLEDGED");
    assert.deepEqual(acknowledgement.command.resultDetails, { appVersion: "11b", manifestVersion: null, sourceStatus: "CONNECTED" });

    await database.playerCommand.create({
      data: { organisationId, playerId: player.id, requestedById: userId, kind: "PING", requestedAt: new Date(now.getTime() - 120_000), expiresAt: new Date(now.getTime() - 60_000) }
    });
    assert.deepEqual(await expirePlayerCommands(database, { now }), { expired: 1 });

    const pending = await database.playerCommand.create({
      data: { organisationId, playerId: player.id, requestedById: userId, kind: "REFRESH_STATE", requestedAt: now, expiresAt: new Date(now.getTime() + 600_000) }
    });
    const lifecycle = await transitionPlayerLifecycle(database, {
      playerId: player.id,
      action: "CREATE_REPLACEMENT",
      note: "Hardware replacement test.",
      actorUserId: userId,
      enrolmentTokenHash: `enrol-${suffix}`,
      enrolmentExpiresAt: new Date(now.getTime() + 86_400_000),
      now
    });
    assert.equal((await database.player.findUniqueOrThrow({ where: { id: player.id } })).status, "DISABLED");
    assert.equal(lifecycle.replacement.replacesPlayerId, player.id);
    assert.equal(lifecycle.replacement.status, "PENDING_ENROLMENT");
    assert.equal((await database.playerCommand.findUniqueOrThrow({ where: { id: pending.id } })).status, "CANCELLED");
    assert.equal(await database.auditLog.count({ where: { organisationId, action: "PLAYER_REPLACEMENT_CREATED" } }), 1);
  } finally {
    if (organisationId) await database.organisation.deleteMany({ where: { id: organisationId } });
    if (userId) await database.user.deleteMany({ where: { id: userId } });
    await database.$disconnect();
  }
});
