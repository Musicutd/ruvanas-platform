import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE, lockGeneralStudioAudioProject } from "../../lib/studio-general-asset-boundary.mjs";
import { permanentlyDeleteAudioTake, restoreAudioTake, trashAudioTake } from "../../lib/audio-take-trash-service.js";
import { lockCorrectionsStaffRenderSources } from "../../lib/corrections-staff-render-source-lock.mjs";
import { runSerializableTransaction } from "../../lib/transaction-retry.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

test("general School Studio cannot access or purge supervised Corrections takes", async () => {
  if (!ciDatabase) throw new Error("C9 School Studio integration runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  try {
    const organisation = await db.organisation.create({ data: { name: `Fictional C9 School ${suffix}`, slug: `c9-school-${suffix}` } });
    organisationId = organisation.id;
    const user = await db.user.create({ data: { email: `c9-school-${suffix}@example.invalid`, passwordHash: "CI-only-not-a-login", role: "OWNER" } });
    userId = user.id;
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional CI facility", slug: `c9-school-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional private programme", createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor", createdByUserId: userId
    } });
    async function project(name) {
      return db.audioProject.create({ data: { organisationId, title: name, editDecision: {}, createdByUserId: userId } });
    }
    async function media(name) {
      return db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name, originalName: `${name}.mp3`,
        storageKey: `c9-school/${suffix}/${name}.mp3`, mimeType: "audio/mpeg",
        sizeBytes: 1024n, durationSeconds: 20, mediaType: "ANNOUNCEMENT", status: "READY"
      } });
    }
    async function take(projectId, mediaAssetId) {
      return db.audioTake.create({ data: {
        organisationId, projectId, mediaAssetId, recordedByUserId: userId,
        sourceEditDecision: {}, status: "READY"
      } });
    }
    const normalProject = await project("Ordinary School project");
    const privateProject = await project("Private supervised project");
    const staffProject = await project("Staff render project awaiting submission");
    const normalMedia = await media("ordinary-take");
    const privateMedia = await media("private-take");
    const standaloneMedia = await media("ordinary-media-without-a-take");
    const normalTake = await take(normalProject.id, normalMedia.id);
    const privateTake = await take(privateProject.id, privateMedia.id);
    const ordinaryRender = { organisationId, projectId: normalProject.id,
      version: { state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: normalMedia.id }] } } } };
    const missingSourceRender = { ...ordinaryRender,
      version: { state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: `missing-${suffix}` }] } } } };
    const standaloneSourceRender = { ...ordinaryRender,
      version: { state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: standaloneMedia.id }] } } } };
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: contributor.id,
      programmeId: programme.id, projectId: privateProject.id,
      supervisorUserId: userId, createdByUserId: userId,
      capabilityScope: { purpose: "isolated CI-only test" }
    } });

    const staffVersion = await db.audioProjectVersion.create({ data: {
      projectId: staffProject.id, version: 1, state: { editor: { clips: [] } },
      reason: "CI-only race source", createdByUserId: userId
    } });
    const staffRender = await db.audioRender.create({ data: {
      organisationId, projectId: staffProject.id, versionId: staffVersion.id,
      requestedByUserId: userId, preset: "SCHOOL_RADIO_MP3"
    } });

    let submissionEntered;
    let releaseSubmission;
    const submissionStarted = new Promise((resolve) => { submissionEntered = resolve; });
    const submissionRelease = new Promise((resolve) => { releaseSubmission = resolve; });
    const submission = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AudioProject" WHERE id = ${staffProject.id} FOR UPDATE`;
      await tx.correctionsSubmission.create({ data: {
        programmeId: programme.id, organisationId, facilityId: facility.id,
        revision: 1, renderId: staffRender.id, sourceFingerprint: "CI-only-race",
        organisationPolicyVersion: 1, facilityPolicyVersion: 1,
        titleSnapshot: "CI-only race", evidenceSnapshot: {}, submittedByUserId: userId
      } });
      submissionEntered();
      await submissionRelease;
    }, { timeout: 10_000 });
    await Promise.race([
      submissionStarted,
      submission.then(() => { throw new Error("C3 fixture finished before acquiring the project lock."); })
    ]);
    let generalSettled = false;
    const generalWrite = db.$transaction(async (tx) => {
      await lockGeneralStudioAudioProject(tx, organisationId, staffProject.id);
      return tx.audioProject.update({ where: { id: staffProject.id }, data: { title: "Incorrectly changed by general Studio" } });
    })
      .then(() => ({ ok: true }), (error) => ({ ok: false, error }))
      .finally(() => { generalSettled = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(generalSettled, false, "general Studio must wait for the C3 submission project lock");
    } finally {
      releaseSubmission();
    }
    await submission;
    const guardedWrite = await generalWrite;
    assert.equal(guardedWrite.ok, false);
    assert.equal(guardedWrite.error?.code, "CORRECTIONS_STUDIO_OUTPUT_BLOCKED");
    assert.equal((await db.audioProject.findUnique({ where: { id: staffProject.id } })).title, staffProject.title);

    const visibleProjects = await db.audioProject.findMany({ where: { organisationId, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE }, select: { id: true } });
    assert.ok(visibleProjects.some(({ id }) => id === normalProject.id));
    assert.ok(!visibleProjects.some(({ id }) => id === privateProject.id));
    const visibleMedia = await db.mediaAsset.findMany({ where: { organisationId, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, select: { id: true } });
    assert.ok(visibleMedia.some(({ id }) => id === normalMedia.id));
    assert.ok(!visibleMedia.some(({ id }) => id === privateMedia.id));

    await runSerializableTransaction(db, (tx) => lockCorrectionsStaffRenderSources(tx, { organisationId, render: ordinaryRender }));
    // Existing staff Studio may use READY organisation media that is not an
    // AudioTake. The C9 guard must not change that established behaviour.
    await runSerializableTransaction(db, (tx) => lockCorrectionsStaffRenderSources(tx, { organisationId, render: standaloneSourceRender }));
    await assert.rejects(
      runSerializableTransaction(db, (tx) => lockCorrectionsStaffRenderSources(tx, { organisationId, render: missingSourceRender })),
      /source.*no longer available/i
    );

    await assert.rejects(
      trashAudioTake({ database: db, takeId: privateTake.id, organisationId, userId }),
      (error) => error?.status === 403 && error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED"
    );
    const normalTrashed = await trashAudioTake({ database: db, takeId: normalTake.id, organisationId, userId });
    assert.ok(normalTrashed.trashedAt);
    await assert.rejects(
      runSerializableTransaction(db, (tx) => lockCorrectionsStaffRenderSources(tx, { organisationId, render: ordinaryRender })),
      /source recording.*no longer available/i
    );
    const normalRestored = await restoreAudioTake({ database: db, takeId: normalTake.id, organisationId, userId });
    assert.equal(normalRestored.trashedAt, null);
    await runSerializableTransaction(db, (tx) => lockCorrectionsStaffRenderSources(tx, { organisationId, render: ordinaryRender }));

    await db.audioTake.update({ where: { id: privateTake.id }, data: { trashedAt: new Date("2026-01-01T00:00:00Z"), purgeAfter: new Date("2026-02-01T00:00:00Z") } });
    const deletedKeys = [];
    const storage = { bucketName: "CI-only-no-network", client: { send: async (command) => { deletedKeys.push(command.input.Key); return {}; } } };
    await assert.rejects(
      permanentlyDeleteAudioTake({ database: db, takeId: privateTake.id, organisationId, userId, storage }),
      (error) => error?.status === 403 && error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED"
    );
    assert.deepEqual(deletedKeys, []);
    assert.equal((await db.audioTake.findUnique({ where: { id: privateTake.id } })).permanentlyDeletedAt, null);
    assert.equal((await db.mediaAsset.findUnique({ where: { id: privateMedia.id } })).status, "READY");

    await trashAudioTake({ database: db, takeId: normalTake.id, organisationId, userId });
    let cleanupEntered;
    let releaseCleanup;
    const cleanupStarted = new Promise((resolve) => { cleanupEntered = resolve; });
    const cleanupRelease = new Promise((resolve) => { releaseCleanup = resolve; });
    const gatedStorage = { bucketName: storage.bucketName, client: { send: async (command) => {
      deletedKeys.push(command.input.Key);
      cleanupEntered();
      await cleanupRelease;
      return {};
    } } };
    const deletion = permanentlyDeleteAudioTake({ database: db, takeId: normalTake.id, organisationId, userId, storage: gatedStorage });
    await cleanupStarted;
    let guardSettled = false;
    const concurrentSubmissionGuard = runSerializableTransaction(db, (tx) => lockCorrectionsStaffRenderSources(tx, { organisationId, render: ordinaryRender }))
      .then(() => ({ ok: true }), (error) => ({ ok: false, error }))
      .finally(() => { guardSettled = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(guardSettled, false, "a render-only submission must wait for AudioLab object cleanup");
    } finally {
      releaseCleanup();
    }
    const deleted = await deletion;
    const guarded = await concurrentSubmissionGuard;
    assert.equal(guarded.ok, false);
    // The race can be rejected by either the missing/deleted media check or
    // the AudioTake tombstone check, depending on the serializable retry.
    assert.match(guarded.error.message, /source.*no longer available/i);
    assert.equal(deleted.status, "ARCHIVED");
    assert.deepEqual(deletedKeys, [normalMedia.storageKey]);
    assert.equal((await db.mediaAsset.findUnique({ where: { id: normalMedia.id } })).status, "DELETED");
  } finally {
    try {
      if (organisationId) {
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioProjectVersion.deleteMany({ where: { project: { organisationId } } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  }
});
