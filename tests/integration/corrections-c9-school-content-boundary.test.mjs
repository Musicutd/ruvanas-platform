import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  generalSchoolNewsStoryWhere,
  generalSchoolRundownWhere,
  lockGeneralSchoolItemSource,
  lockGeneralSchoolRundown
} from "../../lib/school-general-content-boundary.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function waitForProjectLock(db, holderPid, settled) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%"AudioProject"%FOR UPDATE%'
        AND ${holderPid}::integer = ANY(pg_blocking_pids(pid))
        AND pid <> pg_backend_pid()`;
    if (waiters.length) return;
    if (settled()) throw new Error("The School rundown check finished before waiting for the project lock.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The School rundown check did not reach the private-project lock.");
}

test("School content queries and a locked review reject newly private Corrections sources", async () => {
  if (!ciDatabase) throw new Error("C9 School content integration runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let heldTransition;
  try {
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 School content ${suffix}`,
      slug: `c9-school-content-${suffix}`
    } });
    organisationId = organisation.id;
    const user = await db.user.create({ data: {
      email: `c9-school-content-${suffix}@example.invalid`,
      passwordHash: "CI-only-not-a-login",
      role: "OWNER"
    } });
    userId = user.id;
    const supervisor = await db.staffSupervisor.create({ data: { organisationId, userId } });
    const schoolProgramme = await db.schoolProgramme.create({ data: {
      organisationId, supervisorId: supervisor.id, title: "Fictional School programme", createdByUserId: userId
    } });
    const normalEpisode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: schoolProgramme.id, title: "Ordinary School episode",
      status: "APPROVED", createdByUserId: userId
    } });
    const privateEpisode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: schoolProgramme.id, title: "Previously approved School episode",
      status: "APPROVED", createdByUserId: userId
    } });
    const normalProject = await db.audioProject.create({ data: {
      organisationId, episodeId: normalEpisode.id, title: "Ordinary School project",
      editDecision: {}, createdByUserId: userId
    } });
    const privateProject = await db.audioProject.create({ data: {
      organisationId, episodeId: privateEpisode.id, title: "Project later made private",
      editDecision: {}, createdByUserId: userId
    } });
    async function media(name) {
      return db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name,
        originalName: `${name}.mp3`, storageKey: `c9-school-content/${suffix}/${name}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
    }
    const normalMedia = await media("ordinary-school-audio");
    const privateMedia = await media("historically-linked-audio");
    const normalTake = await db.audioTake.create({ data: {
      organisationId, projectId: normalProject.id, mediaAssetId: normalMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });
    const privateTake = await db.audioTake.create({ data: {
      organisationId, projectId: privateProject.id, mediaAssetId: privateMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });
    async function rundown(episodeId, takeId, label) {
      return db.schoolRundown.create({ data: {
        organisationId, episodeId, status: "APPROVED", revision: 1,
        approvedRevision: 1, createdByUserId: userId,
        items: { create: { type: "VOICE_TRACK", position: 0, label, sourceTakeId: takeId } }
      } });
    }
    const normalRundown = await rundown(normalEpisode.id, normalTake.id, "Ordinary voice");
    const privateRundown = await rundown(privateEpisode.id, privateTake.id, "Historical private voice");
    async function story(title, audioProjectId, interviewMediaAssetId) {
      return db.schoolNewsStory.create({ data: {
        organisationId, product: "SCHOOL_RADIO", title, type: "NEWS_BULLETIN",
        audioProjectId, interviewMediaAssetId, createdByUserId: userId
      } });
    }
    const normalStory = await story("Ordinary School story", normalProject.id, normalMedia.id);
    const privateStory = await story("Story with current private links", privateProject.id, privateMedia.id);
    const oldProjectStory = await story("Story with private revision project", normalProject.id, normalMedia.id);
    const oldMediaStory = await story("Story with private revision audio", normalProject.id, normalMedia.id);
    const oldEpisodeStory = await db.schoolNewsStory.create({ data: {
      organisationId, product: "SCHOOL_RADIO", title: "Story with historical private episode",
      type: "NEWS_BULLETIN", episodeId: privateEpisode.id, createdByUserId: userId
    } });
    async function revision(storyId, revisionNumber, audioProjectId, interviewMediaAssetId) {
      await db.newsStoryRevision.create({ data: {
        organisationId, storyId, revision: revisionNumber, audioProjectId,
        interviewMediaAssetId, createdByUserId: userId
      } });
    }
    await revision(normalStory.id, 1, normalProject.id, normalMedia.id);
    await revision(oldProjectStory.id, 1, privateProject.id, normalMedia.id);
    await revision(oldMediaStory.id, 1, normalProject.id, privateMedia.id);

    async function visible() {
      const [rundowns, stories] = await Promise.all([
        db.schoolRundown.findMany({
          where: { organisationId, ...generalSchoolRundownWhere(organisationId) }, select: { id: true }
        }),
        db.schoolNewsStory.findMany({
          where: { organisationId, ...generalSchoolNewsStoryWhere(organisationId) }, select: { id: true }
        })
      ]);
      return {
        rundowns: new Set(rundowns.map(({ id }) => id)),
        stories: new Set(stories.map(({ id }) => id))
      };
    }
    const before = await visible();
    assert.deepEqual(before.rundowns, new Set([normalRundown.id, privateRundown.id]));
    assert.deepEqual(before.stories, new Set([normalStory.id, privateStory.id, oldProjectStory.id, oldMediaStory.id, oldEpisodeStory.id]));

    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional CI facility", slug: `c9-content-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const correctionsProgramme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional private programme",
      createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor",
      createdByUserId: userId
    } });
    assert.equal(await db.$transaction((tx) => lockGeneralSchoolRundown(tx, organisationId, privateRundown.id), { isolationLevel: "ReadCommitted" }), true);
    await db.schoolRundown.update({ where: { id: privateRundown.id }, data: { status: "IN_REVIEW", approvedRevision: null } });
    await db.schoolEpisode.update({ where: { id: privateEpisode.id }, data: { status: "IN_REVIEW", approvedAt: null } });
    // Hold the source project while Corrections attaches the supervised
    // session. A School review must wait, then reject the newly private
    // source instead of approving its earlier visible snapshot.
    let entered;
    let release;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const work = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${privateProject.id} FOR UPDATE`;
      await tx.correctionsStudioSession.create({ data: {
        organisationId, facilityId: facility.id, contributorId: contributor.id,
        programmeId: correctionsProgramme.id, projectId: privateProject.id,
        supervisorUserId: userId, createdByUserId: userId,
        capabilityScope: { purpose: "isolated CI-only School scheduling race" }
      } });
      entered(pid);
      await gate;
    }, { timeout: 25_000 });
    heldTransition = { work, release, pid: await Promise.race([
      started,
      work.then(() => { throw new Error("The Inside fixture finished before holding the source lock."); })
    ]) };
    let decisionSettled = false;
    const pendingDecision = db.$transaction(async (tx) => {
      if (!await lockGeneralSchoolRundown(tx, organisationId, privateRundown.id)) return false;
      const current = await tx.schoolRundown.findFirst({
        where: { id: privateRundown.id, organisationId, ...generalSchoolRundownWhere(organisationId) },
        select: { id: true, episodeId: true, revision: true }
      });
      if (!current) return false;
      await tx.schoolRundown.update({ where: { id: current.id }, data: {
        status: "APPROVED", approvedRevision: current.revision, reviewedByUserId: userId
      } });
      await tx.schoolEpisode.update({ where: { id: current.episodeId }, data: { status: "APPROVED", approvedAt: new Date() } });
      return true;
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 }
    ).then((value) => ({ value }), (error) => ({ error })).finally(() => { decisionSettled = true; });
    let waitError;
    try {
      await waitForProjectLock(db, heldTransition.pid, () => decisionSettled);
    } catch (error) {
      waitError = error;
    } finally {
      heldTransition.release();
    }
    await heldTransition.work;
    heldTransition = null;
    const decision = await pendingDecision;
    if (waitError) throw waitError;
    if (decision.error) throw decision.error;
    assert.equal(decision.value, false);
    assert.equal((await db.schoolRundown.findUnique({ where: { id: privateRundown.id } })).status, "IN_REVIEW");
    assert.equal((await db.schoolEpisode.findUnique({ where: { id: privateEpisode.id } })).status, "IN_REVIEW");

    const after = await visible();
    assert.deepEqual(after.rundowns, new Set([normalRundown.id]));
    assert.deepEqual(after.stories, new Set([normalStory.id]));
    assert.equal(await db.schoolRundown.count({ where: { id: privateRundown.id, organisationId, ...generalSchoolRundownWhere(organisationId) } }), 0);
    assert.equal(await db.schoolNewsStory.count({ where: { id: oldProjectStory.id, organisationId, ...generalSchoolNewsStoryWhere(organisationId) } }), 0);
    assert.equal(await db.schoolNewsStory.count({ where: { id: oldMediaStory.id, organisationId, ...generalSchoolNewsStoryWhere(organisationId) } }), 0);
    assert.equal(await db.schoolNewsStory.count({ where: { id: oldEpisodeStory.id, organisationId, ...generalSchoolNewsStoryWhere(organisationId) } }), 0);

    // A new voice source is not among the rundown's existing locked items.
    // Corrections may attach its project while an ADD_ITEM request is in
    // flight; the proposed-source lock must wait and reject that new item.
    const candidateProject = await db.audioProject.create({ data: {
      organisationId, episodeId: normalEpisode.id, title: "Candidate School voice project",
      editDecision: {}, createdByUserId: userId
    } });
    const candidateMedia = await media("candidate-school-audio");
    const candidateTake = await db.audioTake.create({ data: {
      organisationId, projectId: candidateProject.id, mediaAssetId: candidateMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });
    const originalItemCount = await db.schoolRundownItem.count({ where: { rundownId: normalRundown.id } });
    let enteredCandidate;
    let releaseCandidate;
    const candidateStarted = new Promise((resolve) => { enteredCandidate = resolve; });
    const candidateGate = new Promise((resolve) => { releaseCandidate = resolve; });
    const candidateTransition = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${candidateProject.id} FOR UPDATE`;
      await tx.correctionsStudioSession.create({ data: {
        organisationId, facilityId: facility.id, contributorId: contributor.id,
        programmeId: correctionsProgramme.id, projectId: candidateProject.id,
        supervisorUserId: userId, createdByUserId: userId,
        capabilityScope: { purpose: "isolated CI-only School item race" }
      } });
      enteredCandidate(pid);
      await candidateGate;
    }, { timeout: 25_000 });
    heldTransition = { work: candidateTransition, release: releaseCandidate, pid: await Promise.race([
      candidateStarted,
      candidateTransition.then(() => { throw new Error("The proposed source became private before holding its project lock."); })
    ]) };
    let editSettled = false;
    const pendingEdit = db.$transaction(async (tx) => {
      if (!await lockGeneralSchoolRundown(tx, organisationId, normalRundown.id)) return false;
      await lockGeneralSchoolItemSource(tx, organisationId, { type: "VOICE_TRACK", sourceTakeId: candidateTake.id });
      await tx.schoolRundownItem.create({ data: {
        rundownId: normalRundown.id, position: originalItemCount,
        type: "VOICE_TRACK", label: "Must not add private voice", sourceTakeId: candidateTake.id
      } });
      return true;
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 }
    ).then((value) => ({ value }), (error) => ({ error })).finally(() => { editSettled = true; });
    let candidateWaitError;
    try {
      await waitForProjectLock(db, heldTransition.pid, () => editSettled);
    } catch (error) {
      candidateWaitError = error;
    } finally {
      heldTransition.release();
    }
    await heldTransition.work;
    heldTransition = null;
    const edit = await pendingEdit;
    if (candidateWaitError) throw candidateWaitError;
    assert.equal(edit.error?.code, "CORRECTIONS_STUDIO_OUTPUT_BLOCKED");
    assert.equal(await db.schoolRundownItem.count({ where: { rundownId: normalRundown.id } }), originalItemCount);
    assert.equal((await db.schoolRundown.findUnique({ where: { id: normalRundown.id } })).status, "APPROVED");
  } finally {
    if (heldTransition) {
      heldTransition.release();
      await heldTransition.work.catch(() => {});
    }
    try {
      if (organisationId) {
        await db.newsStoryRevision.deleteMany({ where: { organisationId } });
        await db.schoolNewsStory.deleteMany({ where: { organisationId } });
        await db.schoolRundownItem.deleteMany({ where: { rundown: { organisationId } } });
        await db.schoolRundown.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.schoolEpisode.deleteMany({ where: { organisationId } });
        await db.schoolProgramme.deleteMany({ where: { organisationId } });
        await db.staffSupervisor.deleteMany({ where: { organisationId } });
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
