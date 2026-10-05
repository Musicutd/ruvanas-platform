import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { canDeleteUncommittedCorrectionsRecording } from "../../lib/corrections-recording-cleanup.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function waitForProjectLock(db, holderPid) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%"AudioProject"%FOR UPDATE%'
        AND ${holderPid}::integer = ANY(pg_blocking_pids(pid))
        AND pid <> pg_backend_pid()`;
    if (waiters.length) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("The recording cleanup did not wait for the in-flight project write.");
}

test("ambiguous contributor commit preserves its exact private recording after the project lock", async () => {
  if (!ciDatabase) throw new Error("Contributor cleanup runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let projectId;
  let releaseWriter;
  let writer;
  let decision;
  try {
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 recording cleanup ${suffix}`, slug: `c9-recording-cleanup-${suffix}`
    } });
    organisationId = organisation.id;
    const user = await db.user.create({ data: {
      email: `c9-recording-cleanup-${suffix}@example.invalid`, passwordHash: "ci-only-unusable", role: "OWNER"
    } });
    userId = user.id;
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional supervised recording", editDecision: {}, createdByUserId: userId
    } });
    projectId = project.id;
    const storageKey = `organisations/${organisationId}/corrections-studio/${projectId}/${randomUUID()}.wav`;
    let lockReady;
    let lockFailed;
    const locked = new Promise((resolve, reject) => { lockReady = resolve; lockFailed = reject; });
    writer = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${projectId} FOR UPDATE`;
      lockReady(pid);
      await new Promise((resolve) => { releaseWriter = resolve; });
      const media = await tx.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional recording",
        originalName: "fictional.wav", storageKey, mimeType: "audio/wav", sizeBytes: 128n,
        durationSeconds: 1, mediaType: "ANNOUNCEMENT", status: "READY"
      } });
      const take = await tx.audioTake.create({ data: {
        organisationId, projectId, mediaAssetId: media.id, recordedByUserId: userId,
        durationMs: 1000, status: "READY", sourceEditDecision: {}
      } });
      await tx.auditLog.create({ data: {
        organisationId, action: "CORRECTIONS_STUDIO_RECORDING_CREATED",
        entityType: "AudioTake", entityId: take.id, details: { synthetic: true }
      } });
    }, { isolationLevel: "Serializable", timeout: 20_000 });
    writer.catch(lockFailed);
    const holderPid = await locked;
    decision = canDeleteUncommittedCorrectionsRecording(db, { organisationId, projectId, storageKey });
    decision.catch(() => {});
    await waitForProjectLock(db, holderPid);
    releaseWriter();
    releaseWriter = null;
    await writer;
    assert.equal(await decision, false, "a committed exact-key reference must preserve private audio");
    assert.equal(await db.mediaAsset.count({ where: { storageKey, status: "READY" } }), 1);
    assert.equal(await db.audioTake.count({ where: { projectId, status: "READY" } }), 1);
    assert.equal(await db.auditLog.count({ where: { organisationId, action: "CORRECTIONS_STUDIO_RECORDING_CREATED" } }), 1);
  } finally {
    releaseWriter?.();
    await writer?.catch(() => {});
    await decision?.catch(() => {});
    try {
      if (organisationId) {
        await db.auditLog.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  }
});
