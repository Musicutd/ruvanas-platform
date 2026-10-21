// Optional disposable LOCAL PostgreSQL acceptance. Never use application DB URLs.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { assertNoOpenSourceSession, openSourceSession, closeSourceSession } from "../../lib/online-radio-source-session.mjs";
import { createOnlineRadioDeliveryLedger } from "../../lib/online-radio-delivery-ledger.mjs";
import { loadSenderReport } from "../../scripts/online-radio-source-report.mjs";

const fixtureUrl = process.env.RUVANAS_ENCODER_LOCAL_TEST_DB;
test("actual local PostgreSQL validates source-run receipts, source accounting and read-only reporting", { skip: !fixtureUrl }, async () => {
  const url = new URL(fixtureUrl);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/encoder_source_fixture"); assert.equal(url.username, "encoder_fixture");
  assert.equal(url.password, ""); assert.equal(url.search, "");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: url.href });
  const cuid = () => `c${randomBytes(12).toString("hex")}`;
  const identity = { organisationId: cuid(), stationId: cuid(), destinationId: cuid(), sessionId: randomUUID() };
  const { sessionId, ...scope } = identity;
  try {
    // This exact, empty-table schema exists ONLY in the named temporary fixture DB.
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AuditLog" (
      id TEXT PRIMARY KEY, "organisationId" TEXT, "schoolNetworkId" TEXT, "stationNetworkId" TEXT,
      "actorUserId" TEXT, "actorServiceAccountId" TEXT, action TEXT NOT NULL,
      "entityType" TEXT NOT NULL, "entityId" TEXT, details JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    assert.equal((await assertNoOpenSourceSession(db, scope)).clear, true);
    await openSourceSession(db, identity);
    await assert.rejects(assertNoOpenSourceSession(db, scope), { code: "SOURCE_SESSION_UNCLOSED" });
    const ledger = createOnlineRadioDeliveryLedger({ prisma: db, identity });
    const eventAt = new Date(), trackId = cuid(), mediaAssetId = cuid();
    await ledger.record({ type: "STARTED", segmentSequence: 1, trackId, mediaAssetId, eventAt });
    await ledger.record({ type: "AUDIO_SENT", segmentSequence: 1, trackId, mediaAssetId, eventAt,
      transmittedBytes: 417, transmittedSeconds: 1152 / 44100, observationBasis: "SOURCE_WRITE_CALLBACK" });
    await ledger.record({ type: "ENDED", segmentSequence: 1, trackId, mediaAssetId, eventAt,
      transmittedBytes: 834, transmittedSeconds: 2304 / 44100, observationBasis: "SOURCE_WRITE_CALLBACK", reasonCode: "SOURCE_FILE_ENDED" });
    await ledger.drain();
    // A completed track is NOT a receipt that the complete source run closed.
    await assert.rejects(assertNoOpenSourceSession(db, scope), { code: "SOURCE_SESSION_UNCLOSED" });
    await closeSourceSession(db, identity, { stopConfirmed: true, ledgerDrained: true });
    assert.equal((await assertNoOpenSourceSession(db, scope)).clear, true);
    const report = await loadSenderReport(db, { organisationId: identity.organisationId, stationId: identity.stationId,
      from: new Date(eventAt.getTime() - 1000).toISOString(), to: new Date(eventAt.getTime() + 1000).toISOString() });
    assert.equal(report.rows.length, 1); assert.equal(report.rows[0].observedTransmittedBytes, 834);
    assert.equal(report.rows[0].listenerProof, false); assert.equal(report.rows[0].royaltyConfirmed, false);
    const another = { ...identity, sessionId: randomUUID() };
    await openSourceSession(db, another); await closeSourceSession(db, another, { stopConfirmed: true, ledgerDrained: true });
    assert.equal((await assertNoOpenSourceSession(db, scope)).clear, true, "closed history cannot block healthy future runs");
  } finally { await db.$disconnect(); }
});
