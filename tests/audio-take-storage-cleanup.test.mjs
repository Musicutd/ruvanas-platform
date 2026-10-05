import assert from "node:assert/strict";
import test from "node:test";
import { permanentlyDeleteAudioTake, purgeExpiredAudioTakes } from "../lib/audio-take-trash-service.js";

function createFixture() {
  const take = {
    id: "fictional-take", organisationId: "fictional-org", projectId: "fictional-project",
    mediaAssetId: "fictional-media", recordedByUserId: "fictional-user", promoVersionId: null,
    status: "READY", trashedAt: new Date("2026-01-01T00:00:00.000Z"),
    purgeAfter: new Date("2026-02-01T00:00:00.000Z"), permanentlyDeletedAt: null
  };
  const media = { id: "fictional-media", name: "Fictional recording", storageKey: "fictional/key.webm", status: "READY" };
  const audits = [];
  let privateProject = false;
  const database = {
    $transaction: async (work) => work(database),
    $queryRaw: async () => [{ id: "locked" }],
    audioProject: { findFirst: async () => privateProject ? null : { id: take.projectId } },
    audioTake: {
      findFirst: async ({ where }) => where.id === take.id && where.organisationId === take.organisationId
        ? { ...take, mediaAsset: { ...media } } : null,
      findMany: async ({ where }) => take.trashedAt && take.purgeAfter && take.purgeAfter <= where.purgeAfter.lte
        ? [{ id: take.id, organisationId: take.organisationId, recordedByUserId: take.recordedByUserId }]
        : [],
      update: async ({ data }) => { Object.assign(take, data); return { ...take }; },
      updateMany: async ({ where, data }) => {
        if (take.id !== where.id || take.organisationId !== where.organisationId ||
          !take.permanentlyDeletedAt || !take.purgeAfter) return { count: 0 };
        Object.assign(take, data);
        return { count: 1 };
      }
    },
    mediaAsset: {
      findMany: async () => [{ id: media.id }],
      update: async ({ data }) => { Object.assign(media, data); return { ...media }; }
    },
    audioClip: { count: async () => 0 },
    schoolRundownItem: { count: async () => 0 },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  };
  return { database, take, media, audits, setPrivate: (value) => { privateProject = value; } };
}

test("a failed object deletion remains due, and the worker retries it without repeating the tombstone audit", async () => {
  const fixture = createFixture();
  const now = new Date("2026-03-01T00:00:00.000Z");
  const deletedKeys = [];
  let failNext = true;
  const storage = { bucketName: "fictional-bucket", client: { send: async (command) => {
    deletedKeys.push(command.input.Key);
    if (failNext) { failNext = false; throw new Error("synthetic R2 outage"); }
    return {};
  } } };
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      permanentlyDeleteAudioTake({ database: fixture.database, takeId: fixture.take.id,
        organisationId: fixture.take.organisationId, userId: fixture.take.recordedByUserId, now, storage }),
      (error) => error?.code === "AUDIO_TAKE_STORAGE_CLEANUP_FAILED"
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(fixture.take.status, "ARCHIVED");
  assert.equal(fixture.media.status, "DELETED");
  assert.equal(fixture.take.permanentlyDeletedAt?.toISOString(), now.toISOString());
  const nextRetry = new Date(now.getTime() + 60 * 60 * 1000);
  assert.equal(fixture.take.purgeAfter?.toISOString(), nextRetry.toISOString(),
    "failed cleanup remains pending but moves behind other due recordings");
  assert.equal(fixture.audits.length, 1);

  assert.deepEqual(await purgeExpiredAudioTakes(fixture.database, {
    now: new Date(now.getTime() + 1000), storage
  }), { scanned: 0, deleted: 0, blocked: 0, failed: 0 });

  fixture.setPrivate(true);
  const blocked = await purgeExpiredAudioTakes(fixture.database, {
    now: new Date(nextRetry.getTime() + 1000), storage
  });
  assert.deepEqual(blocked, { scanned: 1, deleted: 0, blocked: 1, failed: 0 });
  assert.deepEqual(deletedKeys, [fixture.media.storageKey], "private evidence must not be deleted");
  assert.equal(fixture.take.purgeAfter?.toISOString(), nextRetry.toISOString());

  fixture.setPrivate(false);
  const retried = await purgeExpiredAudioTakes(fixture.database, {
    now: new Date(nextRetry.getTime() + 2000), storage
  });
  assert.deepEqual(retried, { scanned: 1, deleted: 1, blocked: 0, failed: 0 });
  assert.deepEqual(deletedKeys, [fixture.media.storageKey, fixture.media.storageKey]);
  assert.equal(fixture.take.purgeAfter, null, "successful cleanup clears the pending marker");
  assert.equal(fixture.audits.length, 1, "retry must not duplicate the irreversible audit");
  assert.deepEqual(await purgeExpiredAudioTakes(fixture.database, {
    now: new Date(nextRetry.getTime() + 3000), storage
  }), { scanned: 0, deleted: 0, blocked: 0, failed: 0 });
});
