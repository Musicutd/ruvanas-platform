import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";
const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, cookie, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST", headers: { origin: baseUrl, cookie, "content-type": "application/json" },
    body: JSON.stringify(body), redirect: "manual"
  });
}

async function waitForNewsroomProjectLocks(db, holderPid, settled) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`
      SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%"AudioProject"%FOR UPDATE%'
        AND pid <> pg_backend_pid()`;
    // PostgreSQL can queue the second FOR UPDATE behind the first waiter,
    // rather than reporting both as directly blocked by the holder.
    const blockersByPid = new Map(waiters.map(({ pid, blockers }) => [pid, blockers]));
    const waitsForHolder = (pid, visited = new Set()) => {
      if (visited.has(pid)) return false;
      const next = new Set([...visited, pid]);
      return (blockersByPid.get(pid) || []).some((blocker) =>
        blocker === holderPid || (blockersByPid.has(blocker) && waitsForHolder(blocker, next)));
    };
    if (waiters.filter(({ pid }) => waitsForHolder(pid)).length >= 2) return;
    if (settled()) throw new Error("A newsroom publication finished before the private source was committed.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The newsroom routes did not wait for the private project lock.");
}

test("School and Online Newsroom publication waits for a C3 source reclassification", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 Newsroom write integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  let releaseSubmission;
  let pendingSubmission;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 Newsroom ${suffix}`, code: `C9_NEWSROOM_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      schoolRadioEnabled: true, onlineRadioEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 Newsroom ${suffix}`, slug: `c9-newsroom-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-newsroom-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const station = await db.station.create({ data: {
      organisationId, productFamily: "ONLINE", name: "Fictional ordinary station",
      slug: `c9-newsroom-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-newsroom-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional private programme", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Ordinary project becoming private", editDecision: {}, createdByUserId: userId
    } });
    const version = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, state: {}, createdByUserId: userId
    } });
    const render = await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: version.id,
      requestedByUserId: userId, preset: "SCHOOL_RADIO_MP3"
    } });
    const schoolStory = await db.schoolNewsStory.create({ data: {
      organisationId, product: "SCHOOL_RADIO", title: "School story awaiting publication",
      type: "NEWS_BULLETIN", status: "APPROVED", audioProjectId: project.id,
      createdByUserId: userId
    } });
    const onlineStory = await db.schoolNewsStory.create({ data: {
      organisationId, product: "ONLINE_RADIO", stationId: station.id,
      title: "Online story awaiting publication", type: "NEWS_BULLETIN",
      status: "APPROVED", audioProjectId: project.id, createdByUserId: userId
    } });
    const ordinarySchool = await db.schoolNewsStory.create({ data: {
      organisationId, product: "SCHOOL_RADIO", title: "Ordinary school story",
      type: "NEWS_BULLETIN", status: "APPROVED", createdByUserId: userId
    } });
    const ordinaryOnline = await db.schoolNewsStory.create({ data: {
      organisationId, product: "ONLINE_RADIO", stationId: station.id,
      title: "Ordinary online story", type: "NEWS_BULLETIN", status: "APPROVED",
      createdByUserId: userId
    } });

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password }), redirect: "manual"
    });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { releaseSubmission = resolve; });
    pendingSubmission = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${project.id} FOR UPDATE`;
      await tx.correctionsSubmission.create({ data: {
        programmeId: programme.id, organisationId, facilityId: facility.id,
        revision: 1, renderId: render.id, sourceFingerprint: "CI-only-newsroom-race",
        organisationPolicyVersion: 1, facilityPolicyVersion: 1,
        titleSnapshot: programme.title, evidenceSnapshot: {}, submittedByUserId: userId
      } });
      entered(pid);
      await gate;
    }, { timeout: 25_000 });
    const holderPid = await Promise.race([
      started, pendingSubmission.then(() => { throw new Error("The private source transaction finished too early."); })
    ]);
    let settled = false;
    const schoolPublish = api("/api/school-radio/newsroom", cookie, { action: "PUBLISH", storyId: schoolStory.id })
      .finally(() => { settled = true; });
    const onlinePublish = api("/api/newsroom", cookie, { action: "PUBLISH", storyId: onlineStory.id })
      .finally(() => { settled = true; });
    let waitError;
    try {
      await waitForNewsroomProjectLocks(db, holderPid, () => settled);
    } catch (error) {
      waitError = error;
    } finally {
      releaseSubmission();
      releaseSubmission = null;
    }
    await pendingSubmission;
    pendingSubmission = null;
    const [schoolResponse, onlineResponse] = await Promise.all([schoolPublish, onlinePublish]);
    if (waitError) throw waitError;
    assert.equal(schoolResponse.status, 409, await schoolResponse.clone().text());
    assert.equal(onlineResponse.status, 409, await onlineResponse.clone().text());
    const stories = await db.schoolNewsStory.findMany({
      where: { id: { in: [schoolStory.id, onlineStory.id] } }, select: { status: true, publishedAt: true }
    });
    assert.ok(stories.every((story) => story.status === "APPROVED" && story.publishedAt === null));
    assert.equal(await db.newsStoryDecision.count({ where: {
      storyId: { in: [schoolStory.id, onlineStory.id] }, action: "PUBLISH"
    } }), 0);

    for (const [path, storyId] of [
      ["/api/school-radio/newsroom", ordinarySchool.id],
      ["/api/newsroom", ordinaryOnline.id]
    ]) {
      const response = await api(path, cookie, { action: "PUBLISH", storyId });
      assert.equal(response.status, 200, await response.clone().text());
    }
    const overwrite = await api("/api/school-radio/newsroom", cookie, {
      action: "SAVE", storyId: ordinarySchool.id, script: "Unreviewed replacement"
    });
    assert.equal(overwrite.status, 409, await overwrite.clone().text());
    assert.equal((await db.schoolNewsStory.findUnique({ where: { id: ordinarySchool.id } })).script, null);
  } finally {
    if (releaseSubmission) releaseSubmission();
    if (pendingSubmission) await pendingSubmission.catch(() => {});
    try {
      if (organisationId) {
        await db.newsStoryDecision.deleteMany({ where: { organisationId } });
        await db.newsStoryRevision.deleteMany({ where: { organisationId } });
        await db.schoolNewsStory.deleteMany({ where: { organisationId } });
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioProjectVersion.deleteMany({ where: { project: { organisationId } } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.station.deleteMany({ where: { organisationId } });
        await db.correctionsFacility.deleteMany({ where: { location: { organisationId } } });
        await db.location.deleteMany({ where: { organisationId } });
        await db.auditLog.deleteMany({ where: { organisationId } });
        await db.subscription.deleteMany({ where: { organisationId } });
        await db.organisationMember.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
