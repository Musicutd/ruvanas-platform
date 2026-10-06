import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { HeadObjectCommand, ListMultipartUploadsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE, lockGeneralStudioAudioProject } from "../../lib/studio-general-asset-boundary.mjs";
import { permanentlyDeleteAudioTake, restoreAudioTake, trashAudioTake } from "../../lib/audio-take-trash-service.js";
import { canDeleteUncommittedAudioUploadObject } from "../../lib/audio-lab-upload-cleanup.mjs";
import { lockCorrectionsStaffRenderSources } from "../../lib/corrections-staff-render-source-lock.mjs";
import { runSerializableTransaction } from "../../lib/transaction-retry.mjs";
import { inventoryStudioAudioStorage } from "../../lib/studio-audio-storage-inventory.mjs";
import { inventoryStudioAudioUploads } from "../../lib/studio-audio-upload-inventory.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";
const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

async function waitForRouteProjectLock(db, holderPid, settled) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%"AudioProject"%FOR UPDATE%'
        AND ${holderPid}::integer = ANY(pg_blocking_pids(pid))
        AND pid <> pg_backend_pid()`;
    if (waiters.length) return;
    if (settled()) throw new Error("The general Studio route finished before waiting for the C3 project lock.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The general Studio route did not reach the C3 project lock.");
}

async function waitForRouteMediaLock(db, holderPid, settled, table = "MediaAsset") {
  const queryPattern = `%"${table}"%FOR UPDATE%`;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE ${queryPattern}
        AND ${holderPid}::integer = ANY(pg_blocking_pids(pid))
        AND pid <> pg_backend_pid()`;
    if (waiters.length) return;
    if (settled()) throw new Error("The handoff finished before waiting for the shared media attachment.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The handoff did not reach the shared media lock.");
}

test("AudioLab autosave waits for a C3 submission and leaves its private project unchanged", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 School Studio route race runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  let releaseSubmission;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 AudioLab ${suffix}`, code: `C9_AUDIO_${suffix}`,
      productFamily: "SCHOOL", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      schoolRadioEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: { name: `Fictional C9 AudioLab ${suffix}`, slug: `c9-audio-${suffix}` } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-audio-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional C3 facility", slug: `c9-audio-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional C3 programme", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional ordinary project", editDecision: {}, createdByUserId: userId
    } });
    const version = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, state: {}, createdByUserId: userId
    } });
    const render = await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: version.id,
      requestedByUserId: userId, preset: "SCHOOL_RADIO_MP3"
    } });
    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    let submissionEntered;
    const submissionStarted = new Promise((resolve) => { submissionEntered = resolve; });
    const submissionRelease = new Promise((resolve) => { releaseSubmission = resolve; });
    const submission = db.$transaction(async (tx) => {
      const [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "AudioProject" WHERE id = ${project.id} FOR UPDATE`;
      await tx.correctionsSubmission.create({ data: {
        programmeId: programme.id, organisationId, facilityId: facility.id,
        revision: 1, renderId: render.id, sourceFingerprint: "CI-only-autosave-race",
        organisationPolicyVersion: 1, facilityPolicyVersion: 1,
        titleSnapshot: "Fictional C3 programme", evidenceSnapshot: {}, submittedByUserId: userId
      } });
      submissionEntered(holderPid);
      await submissionRelease;
    }, { timeout: 20_000 });
    const holderPid = await Promise.race([
      submissionStarted,
      submission.then(() => { throw new Error("The C3 fixture finished before holding the project lock."); })
    ]);
    let requestSettled = false;
    const autosave = api("/api/school-radio/audio-lab", { method: "PATCH", cookie, body: {
      projectId: project.id, title: "Private project changed by AudioLab", editDecision: { normalize: false }
    } }).finally(() => { requestSettled = true; });
    let lockWaitError = null;
    try {
      await waitForRouteProjectLock(db, holderPid, () => requestSettled);
    } catch (error) {
      lockWaitError = error;
    } finally {
      releaseSubmission();
      releaseSubmission = null;
    }
    await submission;
    const response = await autosave;
    if (lockWaitError) throw new Error(`${lockWaitError.message} Route status: ${response.status}.`);
    assert.equal(response.status, 403, await response.clone().text());
    const unchanged = await db.audioProject.findUnique({ where: { id: project.id } });
    assert.equal(unchanged.title, project.title);
    assert.equal(unchanged.currentVersion, project.currentVersion);
    assert.deepEqual(unchanged.editDecision, project.editDecision);
    assert.equal(await db.audioProjectVersion.count({ where: { projectId: project.id } }), 1);
  } finally {
    if (releaseSubmission) releaseSubmission();
    try {
      if (organisationId) {
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioProjectVersion.deleteMany({ where: { project: { organisationId } } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("Studio handoff listing, reuse and creation wait for C3 privacy transition", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 Studio handoff race runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  let heldSubmission;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 handoff ${suffix}`, code: `C9_HANDOFF_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      onlineRadioEnabled: true, schoolRadioEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 handoff ${suffix}`, slug: `c9-handoff-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-handoff-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional C3 facility", slug: `c9-handoff-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });

    async function approvedRender(label) {
      const media = await db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name: label,
        originalName: `${label}.mp3`, storageKey: `c9-handoff/${suffix}/${label}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
      const promo = await db.promoAsset.create({ data: {
        organisationId, name: label, mediaType: "ANNOUNCEMENT"
      } });
      const promoVersion = await db.promoVersion.create({ data: {
        promoAssetId: promo.id, mediaAssetId: media.id, version: 1,
        status: "APPROVED", qcStatus: "PASSED"
      } });
      const project = await db.audioProject.create({ data: {
        organisationId, title: label, type: "MULTITRACK", editDecision: {}, createdByUserId: userId
      } });
      const version = await db.audioProjectVersion.create({ data: {
        projectId: project.id, version: 1, state: {}, createdByUserId: userId
      } });
      const render = await db.audioRender.create({ data: {
        organisationId, projectId: project.id, versionId: version.id,
        outputMediaAssetId: media.id, outputPromoVersionId: promoVersion.id,
        requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
      } });
      const programme = await db.correctionsProgramme.create({ data: {
        organisationId, facilityId: facility.id, title: `${label} private programme`, createdByUserId: userId
      } });
      return { project, render, programme, version };
    }

    async function holdC3Submission({ project, render, programme }) {
      let entered;
      let release;
      const started = new Promise((resolve) => { entered = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      const work = db.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM "AudioProject" WHERE id = ${project.id} FOR UPDATE`;
        await tx.correctionsSubmission.create({ data: {
          programmeId: programme.id, organisationId, facilityId: facility.id,
          revision: 1, renderId: render.id, sourceFingerprint: "CI-only-handoff-race",
          organisationPolicyVersion: 1, facilityPolicyVersion: 1,
          titleSnapshot: programme.title, evidenceSnapshot: {}, submittedByUserId: userId
        } });
        entered(pid);
        await gate;
      }, { timeout: 25_000 });
      return { work, pid: await Promise.race([
        started,
        work.then(() => { throw new Error("The C3 fixture finished before holding the project lock."); })
      ]), release };
    }

    const historical = await approvedRender("historical-handoff");
    const newOutput = await approvedRender("new-handoff");
    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const handoffPath = "/api/school-radio/studio-destinations";
    const handoffBody = (render) => ({ renderId: render.id, destination: "ONLINE_PODCAST" });
    await db.promoVersion.update({ where: { id: historical.render.outputPromoVersionId }, data: { status: "IN_REVIEW" } });
    const unapproved = await api(handoffPath, { method: "POST", cookie, body: handoffBody(historical.render) });
    assert.equal(unapproved.status, 409, await unapproved.clone().text());
    assert.equal(await db.studioProductHandoff.count({ where: { renderId: historical.render.id } }), 0);
    await db.promoVersion.update({ where: { id: historical.render.outputPromoVersionId }, data: { status: "APPROVED" } });
    const initial = await api(handoffPath, { method: "POST", cookie, body: handoffBody(historical.render) });
    assert.equal(initial.status, 201, await initial.clone().text());
    const reused = await api(handoffPath, { method: "POST", cookie, body: handoffBody(historical.render) });
    assert.equal(reused.status, 200, await reused.clone().text());
    assert.equal((await reused.json()).reused, true);
    const listed = await api(`${handoffPath}?renderId=${historical.render.id}`, { cookie });
    assert.equal(listed.status, 200, await listed.clone().text());
    assert.equal((await listed.json()).handoffs.length, 1);

    heldSubmission = await holdC3Submission(historical);
    let listSettled = false;
    const duringTransition = api(`${handoffPath}?renderId=${historical.render.id}`, { cookie })
      .finally(() => { listSettled = true; });
    let lockWaitError;
    try {
      await waitForRouteProjectLock(db, heldSubmission.pid, () => listSettled);
    } catch (error) {
      lockWaitError = error;
    } finally {
      heldSubmission.release();
    }
    await heldSubmission.work;
    heldSubmission = null;
    const afterTransition = await duringTransition;
    if (lockWaitError) throw new Error(`${lockWaitError.message} Route status: ${afterTransition.status}.`);
    assert.equal(afterTransition.status, 404, await afterTransition.clone().text());
    const oldHandoff = await api(handoffPath, { method: "POST", cookie, body: handoffBody(historical.render) });
    assert.equal(oldHandoff.status, 403, await oldHandoff.clone().text());
    assert.equal(await db.studioProductHandoff.count({ where: { renderId: historical.render.id } }), 1);

    heldSubmission = await holdC3Submission(newOutput);
    let createSettled = false;
    const newHandoff = api(handoffPath, { method: "POST", cookie, body: handoffBody(newOutput.render) })
      .finally(() => { createSettled = true; });
    lockWaitError = null;
    try {
      await waitForRouteProjectLock(db, heldSubmission.pid, () => createSettled);
    } catch (error) {
      lockWaitError = error;
    } finally {
      heldSubmission.release();
    }
    await heldSubmission.work;
    heldSubmission = null;
    const denied = await newHandoff;
    if (lockWaitError) throw new Error(`${lockWaitError.message} Route status: ${denied.status}.`);
    assert.equal(denied.status, 403, await denied.clone().text());
    assert.equal(await db.studioProductHandoff.count({ where: { renderId: newOutput.render.id } }), 0);

    // Privacy can arrive through another project's C4 approved-source take.
    // Its FK lock is on the media, not on the handoff's own project. Exercise
    // list, idempotent reuse and a new School handoff independently.
    const supervisor = await db.staffSupervisor.create({ data: { organisationId, userId } });
    const schoolProgramme = await db.schoolProgramme.create({ data: {
      organisationId, supervisorId: supervisor.id, title: "Fictional handoff programme", createdByUserId: userId
    } });
    const schoolEpisode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: schoolProgramme.id, title: "Fictional handoff episode", createdByUserId: userId
    } });
    const schoolControl = await approvedRender("ordinary-school-handoff");
    await db.audioProject.update({ where: { id: schoolControl.project.id }, data: { episodeId: schoolEpisode.id } });
    const schoolCreated = await api(handoffPath, { method: "POST", cookie, body: {
      renderId: schoolControl.render.id, destination: "SCHOOL_EPISODE"
    } });
    assert.equal(schoolCreated.status, 201, await schoolCreated.clone().text());
    assert.equal(await db.schoolSubmission.count({ where: { organisationId } }), 1);
    assert.equal((await db.schoolEpisode.findUnique({ where: { id: schoolEpisode.id } })).status, "IN_REVIEW");
    // A separate DRAFT target makes the negative CREATE_SCHOOL case otherwise
    // eligible: denial must come from source privacy, not a status transition.
    const pendingSchoolEpisode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: schoolProgramme.id, title: "Fictional pending handoff episode", createdByUserId: userId
    } });
    for (const action of ["LIST", "REUSE", "CREATE_SCHOOL", "PROMO_ONLY"]) {
      const output = await approvedRender(`shared-${action}`);
      if (action === "CREATE_SCHOOL") {
        await db.audioProject.update({ where: { id: output.project.id }, data: { episodeId: pendingSchoolEpisode.id } });
      } else if (action === "REUSE") {
        const ordinary = await api(handoffPath, { method: "POST", cookie, body: handoffBody(output.render) });
        assert.equal(ordinary.status, 201, await ordinary.clone().text());
      }
      const handoffsBefore = await db.studioProductHandoff.count({ where: { organisationId } });
      const auditsBefore = await db.auditLog.count({ where: { organisationId, action: "STUDIO_PRODUCT_HANDOFF_CREATED" } });
      const schoolBefore = await db.schoolEpisode.findUnique({ where: { id: pendingSchoolEpisode.id } });
      const schoolSubmissionsBefore = await db.schoolSubmission.count({ where: { organisationId } });
      let entered;
      let release;
      const started = new Promise((resolve) => { entered = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      const work = db.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        if (action === "PROMO_ONLY") {
          // This reverse use locks the PromoVersion FK, not MediaAsset. A
          // media-only guard cannot serialize this supported output relation.
          await tx.audioRender.create({ data: {
            organisationId, projectId: historical.project.id, versionId: historical.version.id,
            outputPromoVersionId: output.render.outputPromoVersionId,
            requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
          } });
        } else {
          await tx.audioTake.create({ data: {
            organisationId, projectId: historical.project.id, mediaAssetId: output.render.outputMediaAssetId,
            promoVersionId: output.render.outputPromoVersionId, recordedByUserId: userId,
            durationMs: 20_000, status: "READY", sourceEditDecision: {}
          } });
        }
        entered(pid);
        await gate;
      }, { timeout: 25_000 });
      heldSubmission = { work, release, pid: await Promise.race([
        started, work.then(() => { throw new Error("The attachment ended before holding its media FK lock."); })
      ]) };
      let settled = false;
      const pending = (action === "LIST"
        ? api(`${handoffPath}?renderId=${output.render.id}`, { cookie })
        : api(handoffPath, { method: "POST", cookie, body: {
          renderId: output.render.id, destination: action === "CREATE_SCHOOL" ? "SCHOOL_EPISODE" : "ONLINE_PODCAST"
        } })).finally(() => { settled = true; });
      lockWaitError = null;
      try {
        await waitForRouteMediaLock(db, heldSubmission.pid, () => settled,
          action === "PROMO_ONLY" ? "PromoVersion" : "MediaAsset");
      } catch (error) {
        lockWaitError = error;
      } finally {
        heldSubmission.release();
      }
      await heldSubmission.work;
      heldSubmission = null;
      const rejected = await pending;
      if (lockWaitError) throw new Error(`${lockWaitError.message} Route status: ${rejected.status}.`);
      assert.equal(rejected.status, 409, await rejected.clone().text());
      assert.equal((await rejected.json()).handoff, undefined);
      assert.equal(await db.studioProductHandoff.count({ where: { organisationId } }), handoffsBefore);
      assert.equal(await db.auditLog.count({ where: { organisationId, action: "STUDIO_PRODUCT_HANDOFF_CREATED" } }), auditsBefore);
      assert.equal(await db.schoolSubmission.count({ where: { organisationId } }), schoolSubmissionsBefore);
      assert.deepEqual(await db.schoolEpisode.findUnique({ where: { id: pendingSchoolEpisode.id } }), schoolBefore);
      assert.equal((await db.audioProject.findUnique({ where: { id: output.project.id } })).status, output.project.status);
    }

    // Even locking the exact output media is insufficient: a newer render
    // can make the other project's older output private without touching it.
    const oldShared = await approvedRender("shared-older-render");
    const newerPrivate = await approvedRender("shared-newer-render");
    await db.audioRender.create({ data: {
      organisationId, projectId: newerPrivate.project.id, versionId: newerPrivate.version.id,
      outputMediaAssetId: oldShared.render.outputMediaAssetId,
      outputPromoVersionId: oldShared.render.outputPromoVersionId,
      requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });
    const beforeOlderHandoff = await db.studioProductHandoff.count({ where: { organisationId } });
    heldSubmission = await holdC3Submission(newerPrivate);
    let olderSettled = false;
    const olderHandoff = api(handoffPath, { method: "POST", cookie, body: handoffBody(oldShared.render) })
      .finally(() => { olderSettled = true; });
    lockWaitError = null;
    try {
      await waitForRouteProjectLock(db, heldSubmission.pid, () => olderSettled);
    } catch (error) {
      lockWaitError = error;
    } finally {
      heldSubmission.release();
    }
    await heldSubmission.work;
    heldSubmission = null;
    const olderRejected = await olderHandoff;
    if (lockWaitError) throw new Error(`${lockWaitError.message} Route status: ${olderRejected.status}.`);
    assert.equal(olderRejected.status, 403, await olderRejected.clone().text());
    assert.equal(await db.studioProductHandoff.count({ where: { organisationId } }), beforeOlderHandoff);
  } finally {
    if (heldSubmission) {
      heldSubmission.release();
      await heldSubmission.work.catch(() => {});
    }
    try {
      if (organisationId) {
        await db.studioProductHandoff.deleteMany({ where: { organisationId } });
        await db.schoolSubmission.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioProjectVersion.deleteMany({ where: { project: { organisationId } } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.schoolEpisode.deleteMany({ where: { organisationId } });
        await db.schoolProgramme.deleteMany({ where: { organisationId } });
        await db.staffSupervisor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId } } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("general School Studio cannot access or purge supervised Corrections takes", async () => {
  if (!ciDatabase) throw new Error("C9 School Studio integration runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let heldPrivateSession;
  let releasePrivateSession;
  let pendingRetry;
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

    // Reverse the lock order: a private session commits while a worker retry
    // waits. The retry's first candidate read must not freeze an older privacy
    // snapshot and delete the newly private object's stored bytes.
    const retryProject = await project("School project before private session");
    const retryMedia = await media("retry-take-becomes-private");
    const retryTake = await take(retryProject.id, retryMedia.id);
    await trashAudioTake({ database: db, takeId: retryTake.id, organisationId, userId });
    const failedStorage = { bucketName: storage.bucketName, client: { send: async () => {
      throw new Error("Synthetic CI object-store failure");
    } } };
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        permanentlyDeleteAudioTake({ database: db, takeId: retryTake.id, organisationId, userId, storage: failedStorage }),
        (error) => error?.code === "AUDIO_TAKE_STORAGE_CLEANUP_FAILED"
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.ok((await db.audioTake.findUnique({ where: { id: retryTake.id } })).purgeAfter);

    let privateSessionEntered;
    const privateSessionStarted = new Promise((resolve) => { privateSessionEntered = resolve; });
    const privateSessionRelease = new Promise((resolve) => { releasePrivateSession = resolve; });
    heldPrivateSession = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "AudioProject" WHERE id = ${retryProject.id} FOR UPDATE`;
      await tx.correctionsStudioSession.create({ data: {
        organisationId, facilityId: facility.id, contributorId: contributor.id,
        programmeId: programme.id, projectId: retryProject.id,
        supervisorUserId: userId, createdByUserId: userId,
        capabilityScope: { purpose: "isolated retry privacy race" }
      } });
      privateSessionEntered(pid);
      await privateSessionRelease;
    }, { timeout: 20_000 });
    const privateHolderPid = await Promise.race([
      privateSessionStarted,
      heldPrivateSession.then(() => { throw new Error("Private-session fixture finished before holding the project lock."); })
    ]);
    let retrySettled = false;
    const retryStorage = { bucketName: storage.bucketName, client: { send: async (command) => {
      deletedKeys.push(command.input.Key);
      return {};
    } } };
    pendingRetry = permanentlyDeleteAudioTake({
      database: db, takeId: retryTake.id, organisationId, userId, storage: retryStorage
    }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
      .finally(() => { retrySettled = true; });
    await waitForRouteProjectLock(db, privateHolderPid, () => retrySettled);
    assert.equal(retrySettled, false);
    releasePrivateSession();
    releasePrivateSession = null;
    await heldPrivateSession;
    const retryResult = await pendingRetry;
    assert.equal(retryResult.ok, false);
    assert.equal(retryResult.error?.code, "CORRECTIONS_STUDIO_OUTPUT_BLOCKED");
    assert.deepEqual(deletedKeys, [normalMedia.storageKey], "newly private bytes must not be deleted");
    assert.equal((await db.mediaAsset.findUnique({ where: { id: retryMedia.id } })).status, "DELETED");
    assert.ok((await db.audioTake.findUnique({ where: { id: retryTake.id } })).purgeAfter,
      "private evidence remains marked for guarded reconciliation, not silently erased");
    const ordinaryPurgeCandidates = await db.audioTake.findMany({
      where: {
        trashedAt: { not: null }, purgeAfter: { lte: new Date(Date.now() + 2 * 60 * 60 * 1000) },
        project: { is: GENERAL_STUDIO_AUDIO_PROJECT_WHERE },
        mediaAsset: { is: GENERAL_STUDIO_MEDIA_ASSET_WHERE }
      }, select: { id: true }
    });
    assert.ok(!ordinaryPurgeCandidates.some(({ id }) => id === retryTake.id),
      "the worker's candidate boundary must exclude a now-private tombstone");

    // Exercise the read-only inventory's real Prisma relation filters against
    // this disposable database; the object-store side stays synthetic.
    const observedAt = new Date();
    const oldObjectDate = new Date(observedAt.getTime() - 10 * 24 * 60 * 60 * 1000);
    const directPrefix = `organisations/${organisationId}/school-audio/${normalProject.id}/`;
    const legacyKey = `${directPrefix}${randomUUID()}.webm`;
    const orphanKey = `${directPrefix}${randomUUID()}.webm`;
    const legacyMedia = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "CI inventory legacy take",
      originalName: "ci-inventory.webm", storageKey: legacyKey, mimeType: "audio/webm",
      sizeBytes: 128n, mediaType: "ANNOUNCEMENT", status: "DELETED"
    } });
    await db.audioTake.create({ data: {
      organisationId, projectId: normalProject.id, mediaAssetId: legacyMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "ARCHIVED",
      trashedAt: oldObjectDate, permanentlyDeletedAt: oldObjectDate
    } });
    const listedObject = { Key: orphanKey, ETag: '"ci-inventory"', Size: 128, LastModified: oldObjectDate };
    const readOnlyStorage = { bucketName: "CI-only-no-network", client: { send: async (command) => {
      if (command instanceof ListObjectsV2Command) return { Contents: [listedObject], IsTruncated: false };
      if (command instanceof HeadObjectCommand) return {
        ETag: '"ci-inventory"', ContentLength: 128, LastModified: oldObjectDate,
        Metadata: { source: "audiolab", project: normalProject.id }
      };
      throw new Error("Inventory sent a non-read storage command.");
    } } };
    const inventory = await inventoryStudioAudioStorage({
      database: db, storage: readOnlyStorage, organisationId, now: observedAt
    });
    assert.equal(inventory.pages.final.items[0].classification, "UNREFERENCED_REVIEW");
    assert.equal(inventory.pages.legacy.items[0].classification, "LEGACY_TOMBSTONE_OBJECT_REVIEW");

    const normalQuarantineKey = `quarantine/${organisationId}/audio-lab/${normalProject.id}/${randomUUID()}.webm`;
    const privateQuarantineKey = `quarantine/${organisationId}/audio-lab/${privateProject.id}/${randomUUID()}.webm`;
    const normalUploadId = `ci-normal-${randomUUID()}`;
    const privateUploadId = `ci-private-${randomUUID()}`;
    for (const [projectId, quarantineKey, multipartUploadId] of [
      [normalProject.id, normalQuarantineKey, normalUploadId],
      [privateProject.id, privateQuarantineKey, privateUploadId]
    ]) {
      await db.schoolAudioUploadSession.create({ data: {
        organisationId, projectId, quarantineKey, multipartUploadId,
        createdByUserId: userId, originalName: "ci-inventory.webm", mimeType: "audio/webm",
        expectedSizeBytes: 128n, partSizeBytes: 128, partCount: 1,
        status: "FAILED", expiresAt: oldObjectDate
      } });
    }
    const uploadInventoryStorage = { bucketName: "CI-only-no-network", client: { send: async (command) => {
      if (command instanceof ListObjectsV2Command) return { IsTruncated: false, Contents: [
        { Key: normalQuarantineKey, ETag: '"normal"', Size: 128, LastModified: oldObjectDate },
        { Key: privateQuarantineKey, ETag: '"private"', Size: 128, LastModified: oldObjectDate }
      ] };
      if (command instanceof ListMultipartUploadsCommand) return { IsTruncated: false, Uploads: [
        { Key: normalQuarantineKey, UploadId: normalUploadId, Initiated: oldObjectDate },
        { Key: privateQuarantineKey, UploadId: privateUploadId, Initiated: oldObjectDate }
      ] };
      if (command instanceof HeadObjectCommand && command.input.Key === normalQuarantineKey) return {
        ETag: '"normal"', ContentLength: 128, LastModified: oldObjectDate,
        Metadata: { quarantine: "true", project: normalProject.id }
      };
      throw new Error("Inventory touched private bytes or sent an unexpected storage command.");
    } } };
    const uploadInventory = await inventoryStudioAudioUploads({
      database: db, storage: uploadInventoryStorage, organisationId, now: observedAt
    });
    assert.deepEqual(uploadInventory.pages.quarantine.items.map((item) => item.classification), [
      "OLD_QUARANTINE_OBJECT_REVIEW", "PROTECTED_PROJECT_REVIEW"
    ]);
    assert.deepEqual(uploadInventory.pages.multipart.items.map((item) => item.classification), [
      "OLD_MULTIPART_UPLOAD_REVIEW", "PROTECTED_PROJECT_REVIEW"
    ]);
  } finally {
    if (releasePrivateSession) releasePrivateSession();
    if (heldPrivateSession) await heldPrivateSession.catch(() => {});
    if (pendingRetry) await pendingRetry.catch(() => {});
    try {
      if (organisationId) {
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.schoolAudioUploadSession.deleteMany({ where: { organisationId } });
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

test("AudioLab cleanup waits for an in-flight completion and preserves its committed final object", async () => {
  if (!ciDatabase) throw new Error("C9 AudioLab cleanup race runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let heldCompletion;
  let cleanupDecision;
  let releaseCompletion;
  try {
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 upload cleanup ${suffix}`, slug: `c9-upload-cleanup-${suffix}`
    } });
    organisationId = organisation.id;
    const user = await db.user.create({ data: {
      email: `c9-upload-cleanup-${suffix}@example.invalid`, passwordHash: "CI-only-no-login", role: "OWNER"
    } });
    userId = user.id;
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional AudioLab project", editDecision: {}, createdByUserId: userId
    } });
    const session = await db.schoolAudioUploadSession.create({ data: {
      organisationId, projectId: project.id, status: "COMPLETING",
      originalName: "fictional.webm", mimeType: "audio/webm", expectedSizeBytes: 128n,
      partSizeBytes: 128, partCount: 1,
      quarantineKey: `quarantine/${suffix}/fictional.webm`, multipartUploadId: `ci-only-${suffix}`,
      createdByUserId: userId, expiresAt: new Date(Date.now() + 86_400_000)
    } });
    const finalKey = `organisations/${organisationId}/school-audio/${project.id}/${session.id}.webm`;
    const input = { sessionId: session.id, organisationId, projectId: project.id, finalKey };
    assert.equal(await canDeleteUncommittedAudioUploadObject(db, input), true);

    let completionEntered;
    const completionStarted = new Promise((resolve) => { completionEntered = resolve; });
    const completionRelease = new Promise((resolve) => { releaseCompletion = resolve; });
    heldCompletion = db.$transaction(async (tx) => {
      const [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${project.id} FOR UPDATE`;
      await tx.mediaAsset.create({ data: {
        organisationId, name: "Fictional completed take", originalName: "fictional.webm",
        storageKey: finalKey, mimeType: "audio/webm", sizeBytes: 128n,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
      await tx.schoolAudioUploadSession.update({ where: { id: session.id }, data: {
        status: "COMPLETED", completedAt: new Date()
      } });
      completionEntered(holderPid);
      await completionRelease;
    }, { timeout: 20_000 });
    const holderPid = await Promise.race([
      completionStarted,
      heldCompletion.then(() => { throw new Error("The completion fixture finished before holding the project lock."); })
    ]);
    let decisionSettled = false;
    cleanupDecision = canDeleteUncommittedAudioUploadObject(db, input)
      .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
      .finally(() => { decisionSettled = true; });
    await waitForRouteProjectLock(db, holderPid, () => decisionSettled);
    assert.equal(decisionSettled, false, "cleanup must wait for the completion transaction");
    releaseCompletion();
    releaseCompletion = null;
    await heldCompletion;
    const decision = await cleanupDecision;
    if (!decision.ok) throw decision.error;
    assert.equal(decision.value, false, "a COMPLETED upload cannot have its final object deleted");
    assert.equal((await db.mediaAsset.findUnique({ where: { storageKey: finalKey } })).status, "READY");

    // Even an inconsistent stale status must not override the committed media reference.
    await db.schoolAudioUploadSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
    assert.equal(await canDeleteUncommittedAudioUploadObject(db, input), false);
  } finally {
    if (releaseCompletion) releaseCompletion();
    if (heldCompletion) await heldCompletion.catch(() => {});
    if (cleanupDecision) await cleanupDecision.catch(() => {});
    try {
      if (organisationId) {
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.schoolAudioUploadSession.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  }
});
