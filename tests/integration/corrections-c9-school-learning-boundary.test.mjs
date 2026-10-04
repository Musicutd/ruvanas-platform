import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

async function waitForLearningProjectLock(db, holderPid, settled) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%"AudioProject"%FOR UPDATE%'
        AND ${holderPid}::integer = ANY(pg_blocking_pids(pid))
        AND pid <> pg_backend_pid()`;
    if (waiters.length) return;
    if (settled()) throw new Error("School Learning finished before waiting for the private-project lock.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("School Learning did not reach the private-project lock.");
}

test("School Learning hides historical private episodes, submissions and portfolios", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 School Learning integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  let heldTransition;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 School Learning ${suffix}`, code: `C9_SCHOOL_LEARNING_${suffix}`,
      productFamily: "SCHOOL", tierNumber: 2, monthlyPriceCents: 0, storageLimitGb: 1,
      listenerLimit: 10, maxBitrateKbps: 128, stationLimit: 1, schoolRadioEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 Learning ${suffix}`, slug: `c9-learning-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-learning-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const supervisor = await db.staffSupervisor.create({ data: { organisationId, userId } });
    const group = await db.studentGroup.create({ data: {
      organisationId, supervisorId: supervisor.id, name: `Fictional class ${suffix}`, createdByUserId: userId
    } });
    const contributor = await db.studentContributor.create({ data: {
      organisationId, studentGroupId: group.id, displayName: `Fictional learner ${suffix}`
    } });
    const programme = await db.schoolProgramme.create({ data: {
      organisationId, studentGroupId: group.id, supervisorId: supervisor.id,
      title: `Fictional School programme ${suffix}`, createdByUserId: userId
    } });
    const normalEpisode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: programme.id, title: "Ordinary School Learning episode",
      status: "APPROVED", createdByUserId: userId
    } });
    const privateEpisode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: programme.id, title: "Historical private Learning episode",
      status: "APPROVED", createdByUserId: userId
    } });
    const normalProject = await db.audioProject.create({ data: {
      organisationId, episodeId: normalEpisode.id, title: "Ordinary Learning project",
      status: "READY", editDecision: {}, createdByUserId: userId
    } });
    const linkedProject = await db.audioProject.create({ data: {
      organisationId, episodeId: privateEpisode.id, title: "Other project linked to private episode",
      status: "READY", editDecision: {}, createdByUserId: userId
    } });
    const privateProject = await db.audioProject.create({ data: {
      organisationId, episodeId: privateEpisode.id, title: "Project later supervised by Inside",
      editDecision: {}, createdByUserId: userId
    } });
    const privateMedia = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Historical private Learning audio",
      originalName: "private-learning.mp3", storageKey: `c9-learning/${suffix}/private.mp3`,
      mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
      mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    const privateTake = await db.audioTake.create({ data: {
      organisationId, projectId: privateProject.id, mediaAssetId: privateMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });
    await db.schoolRundown.create({ data: {
      organisationId, episodeId: privateEpisode.id, status: "APPROVED", revision: 1,
      approvedRevision: 1, createdByUserId: userId,
      items: { create: { type: "VOICE_TRACK", position: 0, label: "Historical private voice", sourceTakeId: privateTake.id } }
    } });
    const assignment = await db.assignment.create({ data: {
      organisationId, studentGroupId: group.id, programmeId: programme.id,
      title: "Fictional audio assignment", templateCode: "NEWS_60", status: "OPEN",
      createdByUserId: userId,
      rubric: { create: { title: "Fictional rubric", criteria: { create: { label: "Accuracy", maxScore: 10, position: 1 } } } }
    }, include: { rubric: { include: { criteria: true } } } });
    const criterionId = assignment.rubric.criteria[0].id;
    async function submission(episodeId, status) {
      return db.assignmentSubmission.create({ data: {
        organisationId, assignmentId: assignment.id, episodeId, status,
        recordedByUserId: userId,
        contributors: { create: { contributorId: contributor.id } }
      } });
    }
    const normalSubmission = await submission(normalEpisode.id, "SUBMITTED");
    const privateSubmission = await submission(privateEpisode.id, "ASSESSED");
    const privateAssessment = await db.assessment.create({ data: {
      organisationId, submissionId: privateSubmission.id, status: "RELEASED",
      totalScore: 8, maximumScore: 10, assessedByUserId: userId
    } });
    const privatePortfolio = await db.portfolioEntry.create({ data: {
      organisationId, contributorId: contributor.id, submissionId: privateSubmission.id,
      assessmentId: privateAssessment.id, title: "Historical private portfolio evidence",
      status: "PRIVATE", createdByUserId: userId
    } });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    async function learning() {
      const response = await api("/api/school-radio/learning", { cookie });
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get("cache-control") || "", /private.*no-store/);
      return response.json();
    }
    const before = await learning();
    assert.ok(before.audioProjects.some(({ id }) => id === normalProject.id));
    assert.ok(before.audioProjects.some(({ id }) => id === linkedProject.id));
    assert.ok(before.episodes.some(({ id }) => id === normalEpisode.id));
    assert.ok(before.episodes.some(({ id }) => id === privateEpisode.id));
    assert.ok(before.assignments[0].submissions.some(({ id }) => id === normalSubmission.id));
    assert.ok(before.assignments[0].submissions.some(({ id }) => id === privateSubmission.id));
    assert.ok(before.portfolios.some(({ id }) => id === privatePortfolio.id));

    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-learning-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const correctionsProgramme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional private programme", createdByUserId: userId
    } });
    const correctionsContributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional private contributor", createdByUserId: userId
    } });
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: correctionsContributor.id,
      programmeId: correctionsProgramme.id, projectId: privateProject.id,
      supervisorUserId: userId, createdByUserId: userId,
      capabilityScope: { purpose: "isolated CI-only School Learning privacy test" }
    } });

    const after = await learning();
    assert.ok(after.audioProjects.some(({ id }) => id === normalProject.id));
    assert.ok(!after.audioProjects.some(({ id }) => id === linkedProject.id));
    assert.ok(after.episodes.some(({ id }) => id === normalEpisode.id));
    assert.ok(!after.episodes.some(({ id }) => id === privateEpisode.id));
    const visibleSubmissions = after.assignments.flatMap(({ submissions }) => submissions);
    assert.ok(visibleSubmissions.some(({ id }) => id === normalSubmission.id));
    assert.ok(!visibleSubmissions.some(({ id }) => id === privateSubmission.id));
    assert.ok(!after.portfolios.some(({ id }) => id === privatePortfolio.id));
    assert.ok(!JSON.stringify(after).includes("Historical private Learning episode"));
    assert.ok(!JSON.stringify(after).includes("Historical private portfolio evidence"));
    assert.ok(!JSON.stringify(after).includes("Other project linked to private episode"));

    const action = (body) => api("/api/school-radio/learning", { method: "POST", cookie, body });
    const blockedSubmission = await action({
      action: "SUBMIT_ASSIGNMENT", assignmentId: assignment.id, contributorIds: [contributor.id], episodeId: privateEpisode.id
    });
    assert.equal(blockedSubmission.status, 404, await blockedSubmission.clone().text());
    const blockedProjectSubmission = await action({
      action: "SUBMIT_ASSIGNMENT", assignmentId: assignment.id, contributorIds: [contributor.id], audioProjectId: linkedProject.id
    });
    assert.equal(blockedProjectSubmission.status, 404, await blockedProjectSubmission.clone().text());
    const blockedAssessment = await action({
      action: "ASSESS_SUBMISSION", submissionId: privateSubmission.id,
      scores: [{ criterionId, score: 8 }]
    });
    assert.equal(blockedAssessment.status, 404, await blockedAssessment.clone().text());
    const blockedPortfolio = await action({
      action: "ADD_PORTFOLIO_ENTRY", submissionId: privateSubmission.id,
      contributorId: contributor.id, title: "Must remain private"
    });
    assert.equal(blockedPortfolio.status, 404, await blockedPortfolio.clone().text());
    assert.equal(await db.portfolioEntry.count({ where: { organisationId, submissionId: privateSubmission.id } }), 1);

    const ordinarySubmission = await action({
      action: "SUBMIT_ASSIGNMENT", assignmentId: assignment.id,
      contributorIds: [contributor.id], episodeId: normalEpisode.id
    });
    assert.equal(ordinarySubmission.status, 201, await ordinarySubmission.clone().text());
    const ordinaryProjectSubmission = await action({
      action: "SUBMIT_ASSIGNMENT", assignmentId: assignment.id,
      contributorIds: [contributor.id], audioProjectId: normalProject.id
    });
    assert.equal(ordinaryProjectSubmission.status, 201, await ordinaryProjectSubmission.clone().text());
    const ordinaryAssessment = await action({
      action: "ASSESS_SUBMISSION", submissionId: normalSubmission.id,
      scores: [{ criterionId, score: 8 }]
    });
    assert.equal(ordinaryAssessment.status, 200, await ordinaryAssessment.clone().text());
    const ordinaryPortfolio = await action({
      action: "ADD_PORTFOLIO_ENTRY", submissionId: normalSubmission.id,
      contributorId: contributor.id, title: "Ordinary School evidence"
    });
    assert.equal(ordinaryPortfolio.status, 201, await ordinaryPortfolio.clone().text());

    // Hold the same project row that an Inside attachment references. The
    // Learning POST must wait, then evaluate the committed private state.
    const beforeRace = await db.assignmentSubmission.count({ where: { organisationId, audioProjectId: normalProject.id } });
    let entered;
    let release;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const work = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${normalProject.id} FOR UPDATE`;
      await tx.correctionsStudioSession.create({ data: {
        organisationId, facilityId: facility.id, contributorId: correctionsContributor.id,
        programmeId: correctionsProgramme.id, projectId: normalProject.id,
        supervisorUserId: userId, createdByUserId: userId,
        capabilityScope: { purpose: "isolated CI-only Learning write race" }
      } });
      entered(pid);
      await gate;
    }, { timeout: 25_000 });
    heldTransition = { work, release, pid: await Promise.race([
      started,
      work.then(() => { throw new Error("The Inside fixture finished before holding the project lock."); })
    ]) };
    let learningSettled = false;
    const racedSubmission = action({
      action: "SUBMIT_ASSIGNMENT", assignmentId: assignment.id,
      contributorIds: [contributor.id], audioProjectId: normalProject.id
    }).finally(() => { learningSettled = true; });
    let waitError;
    try {
      await waitForLearningProjectLock(db, heldTransition.pid, () => learningSettled);
    } catch (error) {
      waitError = error;
    } finally {
      heldTransition.release();
    }
    await heldTransition.work;
    heldTransition = null;
    const racedResponse = await racedSubmission;
    if (waitError) throw new Error(`${waitError.message} Route status: ${racedResponse.status}.`);
    assert.equal(racedResponse.status, 404, await racedResponse.clone().text());
    assert.equal(await db.assignmentSubmission.count({ where: { organisationId, audioProjectId: normalProject.id } }), beforeRace);
  } finally {
    if (heldTransition) {
      heldTransition.release();
      await heldTransition.work.catch(() => {});
    }
    try {
      if (organisationId) {
        await db.portfolioEntry.deleteMany({ where: { organisationId } });
        await db.assessmentAnnotation.deleteMany({ where: { assessment: { organisationId } } });
        await db.assessmentScore.deleteMany({ where: { assessment: { organisationId } } });
        await db.assessment.deleteMany({ where: { organisationId } });
        await db.assignmentSubmissionContributor.deleteMany({ where: { submission: { organisationId } } });
        await db.assignmentSubmission.deleteMany({ where: { organisationId } });
        await db.rubricCriterion.deleteMany({ where: { rubric: { assignment: { organisationId } } } });
        await db.rubric.deleteMany({ where: { assignment: { organisationId } } });
        await db.assignment.deleteMany({ where: { organisationId } });
        await db.schoolRundownItem.deleteMany({ where: { rundown: { organisationId } } });
        await db.schoolRundown.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.schoolEpisode.deleteMany({ where: { organisationId } });
        await db.schoolProgramme.deleteMany({ where: { organisationId } });
        await db.studentContributor.deleteMany({ where: { organisationId } });
        await db.studentGroup.deleteMany({ where: { organisationId } });
        await db.staffSupervisor.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
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
