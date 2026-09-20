import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../../lib/crypto.js";
import {
  registerPreprovisionedRadioStream,
  RadioStreamRegistrationError
} from "../../lib/preprovisioned-radio-stream-registration.mjs";

function disposableDatabaseReady() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    return process.env.RUN_DATABASE_TESTS === "1" &&
      url.hostname === "127.0.0.1" && url.port === "55432" &&
      url.pathname === "/ruvanas_disposable_acceptance" &&
      /^[a-f\d]{64}$/i.test(process.env.SECRET_ENCRYPTION_KEY || "");
  } catch {
    return false;
  }
}

test("prepared radio stream registration is encrypted, audited, unique and quarantined in disposable PostgreSQL", {
  skip: disposableDatabaseReady() ? false : "Requires the explicit loopback-only disposable PostgreSQL instance and test encryption key"
}, async () => {
  const db = new PrismaClient();
  let actorId;
  let slotId;
  const suffix = randomUUID().replaceAll("-", "");
  const sourcePassword = `local-only-${suffix}`;
  const input = {
    centovaUsername: `test_${suffix}`,
    streamUrl: `https://radio-${suffix}.example.test/stream`,
    serverHost: `source-${suffix}.example.test`,
    serverPort: 8198,
    sourcePort: 8198,
    sourcePassword,
    sourceUsername: "",
    listenerLimit: 10,
    maxBitrateKbps: 128
  };

  try {
    const actor = await db.user.create({
      data: { email: `stream-test-${suffix}@example.invalid`, passwordHash: "not-a-login", role: "SUPER_ADMIN" },
      select: { id: true }
    });
    actorId = actor.id;

    const result = await registerPreprovisionedRadioStream(db, { input, actorUserId: actor.id });
    slotId = result.id;
    assert.equal(result.status, "QUARANTINED");
    assert.equal("sourcePasswordEncrypted" in result, false);

    const stored = await db.preprovisionedRadioStream.findUniqueOrThrow({ where: { id: slotId } });
    assert.equal(stored.status, "QUARANTINED");
    assert.equal(stored.verifiedAt, null);
    assert.equal(stored.stationId, null);
    assert.notEqual(stored.sourcePasswordEncrypted, sourcePassword);
    assert.equal(decryptSecret(stored.sourcePasswordEncrypted), sourcePassword);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: slotId, action: "ONLINE_RADIO_STREAM_SLOT_REGISTERED" }
    });
    assert.equal(audit.actorUserId, actor.id);
    assert.doesNotMatch(JSON.stringify(audit.details), /local-only-|sourcePassword/);

    await assert.rejects(
      registerPreprovisionedRadioStream(db, { input, actorUserId: actor.id }),
      (error) => error instanceof RadioStreamRegistrationError && error.code === "STREAM_SLOT_ALREADY_USED"
    );
    await assert.rejects(db.preprovisionedRadioStream.update({
      where: { id: slotId }, data: { status: "AVAILABLE" }
    }));
    assert.equal((await db.preprovisionedRadioStream.findUniqueOrThrow({ where: { id: slotId } })).status, "QUARANTINED");
  } finally {
    if (slotId) {
      await db.auditLog.deleteMany({ where: { entityId: slotId, action: "ONLINE_RADIO_STREAM_SLOT_REGISTERED" } });
      await db.preprovisionedRadioStream.delete({ where: { id: slotId } });
    }
    if (actorId) await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  }
});
