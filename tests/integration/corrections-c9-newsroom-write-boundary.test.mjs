import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { GENERAL_STATION_MANAGEMENT_WHERE } from "../../lib/general-station-boundary.mjs";
import { lockVisibleOnlineNewsroomCreateTargets, lockVisibleSchoolNewsroomCreateTargets } from "../../lib/newsroom-write-boundary.mjs";
import { lockCorrectionsStaffRenderEvidence, lockCorrectionsStaffRenderSources } from "../../lib/corrections-staff-render-source-lock.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";
const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, cookie, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST", headers: { origin: baseUrl, cookie, "content-type": "application/json" },
    body: JSON.stringify(body), redirect: "manual"
  });
}

async function waitForNewsroomProjectLocks(db, holderPid, settled, minimumWaiters = 2) {
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
    if (waiters.filter(({ pid }) => waitsForHolder(pid)).length >= minimumWaiters) return;
    if (settled()) throw new Error("A newsroom publication finished before the private source was committed.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The newsroom routes did not wait for the private project lock.");
}

async function waitForCreateTargetLock(db, holderPid, table, settled) {
  const deadline = Date.now() + 8_000;
  const pattern = `%FROM "${table}"%FOR UPDATE%`;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE ${pattern}
        AND ${holderPid}::integer = ANY(pg_blocking_pids(pid))
        AND pid <> pg_backend_pid()`;
    if (waiters.length) return;
    if (settled()) throw new Error(`Newsroom CREATE finished before waiting for ${table}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Newsroom CREATE did not wait for ${table}.`);
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

test("Newsroom HTTP writes reject media-only older outputs after a newer C3 render makes their project private", async () => {
  if (!ciDatabase || baseUrl !== "http://127.0.0.1:3100" || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 Newsroom media races run only against the exact disposable CI database and loopback test server.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  let heldTransition;
  let pendingRequest;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 Newsroom media races ${suffix}`, code: `C9_NEWS_MEDIA_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      schoolRadioEnabled: true, onlineRadioEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional Newsroom render races ${suffix}`, slug: `c9-news-render-races-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-news-render-races-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const station = await db.station.create({ data: {
      organisationId, productFamily: "ONLINE", name: "Fictional ordinary Newsroom station",
      slug: `c9-news-render-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const supervisor = await db.staffSupervisor.create({ data: { organisationId, userId } });
    const schoolProgramme = await db.schoolProgramme.create({ data: {
      organisationId, supervisorId: supervisor.id, title: "Fictional Newsroom programme", createdByUserId: userId
    } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional Newsroom render facility", slug: `c9-news-render-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password }), redirect: "manual"
    });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    async function renderPair(caseName, promoOnly) {
      const project = await db.audioProject.create({ data: {
        organisationId, title: `Fictional older Newsroom output ${caseName}`, editDecision: {},
        status: "READY", currentVersion: 2, createdByUserId: userId
      } });
      async function output(versionNumber) {
        const media = await db.mediaAsset.create({ data: {
          organisationId, libraryType: "ORGANISATION_PROMO", name: `Fictional ${caseName} output ${versionNumber}`,
          originalName: "fictional-newsroom-output.mp3", storageKey: `c9-news-render-races/${suffix}/${caseName}-${versionNumber}.mp3`,
          mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20, mediaType: "ANNOUNCEMENT", status: "READY"
        } });
        const promo = await db.promoAsset.create({ data: {
          organisationId, name: `Fictional ${caseName} promo ${versionNumber}`, mediaType: "ANNOUNCEMENT", status: "ACTIVE"
        } });
        const promoVersion = await db.promoVersion.create({ data: {
          promoAssetId: promo.id, mediaAssetId: media.id, version: 1,
          status: "APPROVED", qcStatus: "PASSED", durationSeconds: 20
        } });
        await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: promoVersion.id } });
        const version = await db.audioProjectVersion.create({ data: {
          projectId: project.id, version: versionNumber, state: { editor: { clips: [] } }, createdByUserId: userId
        } });
        const render = await db.audioRender.create({ data: {
          organisationId, projectId: project.id, versionId: version.id,
          // Historical cases deliberately have no direct output-media alias.
          outputMediaAssetId: promoOnly && versionNumber === 1 ? null : media.id,
          outputPromoVersionId: promoVersion.id,
          requestedByUserId: userId, preset: "SCHOOL_RADIO_MP3", status: "SUCCEEDED"
        } });
        return { media, promoVersion, render: { ...render, version } };
      }
      const older = await output(1);
      const newer = await output(2);
      const programme = await db.correctionsProgramme.create({ data: {
        organisationId, facilityId: facility.id, title: `Fictional private Newsroom ${caseName}`, createdByUserId: userId
      } });
      assert.notEqual(older.media.id, newer.media.id, "C3 must lock a different output from the older Newsroom source.");
      if (promoOnly) assert.equal(older.render.outputMediaAssetId, null);
      return { project, older, newer, programme };
    }

    async function createStory(label, { product, action, source }, mediaId) {
      let episodeId = null;
      if (source === "EPISODE_RUNDOWN") {
        const episode = await db.schoolEpisode.create({ data: {
          organisationId, programmeId: schoolProgramme.id, title: `Fictional ${label} episode`,
          status: "APPROVED", approvedAt: new Date(), createdByUserId: userId
        } });
        episodeId = episode.id;
        await db.schoolRundown.create({ data: {
          organisationId, episodeId, status: "APPROVED", revision: 1, approvedRevision: 1,
          createdByUserId: userId, items: { create: {
            type: "INTERVIEW", position: 0, label: "Fictional media-only episode source", sourceMediaAssetId: mediaId
          } }
        } });
      }
      const story = await db.schoolNewsStory.create({ data: {
        organisationId, product, ...(product === "ONLINE_RADIO" ? { stationId: station.id } : {}),
        episodeId, title: `Fictional ${label}`, type: "NEWS_BULLETIN",
        status: action === "SAVE" ? "SCRIPTING" : "APPROVED",
        script: "Unchanged fictional script", factCheckNotes: "Fictional checked notes",
        sourcesJson: [{ label: "Fictional recorded source" }], interviewConsentConfirmed: true,
        interviewMediaAssetId: source === "CURRENT" ? mediaId : null, createdByUserId: userId
      } });
      if (source === "HISTORICAL") await db.newsStoryRevision.create({ data: {
        organisationId, storyId: story.id, revision: 1, script: "Fictional earlier script",
        interviewMediaAssetId: mediaId, createdByUserId: userId
      } });
      assert.equal(story.audioProjectId, null, "Only reverse media associations may protect this story.");
      return story;
    }
    async function snapshot(storyId) {
      const [story, audits] = await Promise.all([
        db.schoolNewsStory.findUnique({ where: { id: storyId }, include: {
          revisions: { orderBy: { revision: "asc" } }, decisions: { orderBy: { id: "asc" } },
          episode: { include: { rundown: { include: { items: { orderBy: { position: "asc" } } } } } }
        } }),
        db.auditLog.findMany({ where: { organisationId, entityType: "NewsStory", entityId: storyId }, orderBy: { id: "asc" } })
      ]);
      return { story, audits };
    }
    const mutation = (scenario, storyId, mediaId) => scenario.action === "SAVE" ? {
      action: "SAVE", storyId, script: "Fictional edited script", factCheckNotes: "Fictional edited fact check",
      sources: [{ label: "Fictional edited source" }], interviewMediaAssetId: mediaId, interviewConsentConfirmed: true
    } : { action: "PUBLISH", storyId };
    const scenarios = [
      ...["SCHOOL_RADIO", "ONLINE_RADIO"].flatMap((product) => [
        { product, action: "SAVE", source: "INCOMING" },
        { product, action: "PUBLISH", source: "CURRENT" },
        { product, action: "PUBLISH", source: "HISTORICAL" }
      ]),
      { product: "SCHOOL_RADIO", action: "PUBLISH", source: "EPISODE_RUNDOWN" }
    ];
    for (const scenario of scenarios) {
      const caseName = `${scenario.product}-${scenario.action}-${scenario.source}`.toLowerCase();
      const path = scenario.product === "SCHOOL_RADIO" ? "/api/school-radio/newsroom" : "/api/newsroom";
      const sources = await renderPair(caseName, scenario.source === "HISTORICAL");
      // Separate matched stories prevent a positive control's transition from
      // making the raced request invalid independently of its privacy source.
      const ordinary = await createStory(`ordinary ${caseName}`, scenario, sources.older.media.id);
      const ordinaryResponse = await api(path, cookie, mutation(scenario, ordinary.id, sources.older.media.id));
      assert.equal(ordinaryResponse.status, 200, await ordinaryResponse.clone().text());
      const ordinaryAfter = await snapshot(ordinary.id);
      assert.equal(ordinaryAfter.audits.length, 1);
      if (scenario.action === "SAVE") {
        assert.equal(ordinaryAfter.story.status, "SCRIPTING");
        assert.equal(ordinaryAfter.story.interviewMediaAssetId, sources.older.media.id);
        assert.equal(ordinaryAfter.story.script, "Fictional edited script");
        assert.equal(ordinaryAfter.story.revisions.length, 1);
        assert.equal(ordinaryAfter.story.revisions[0].interviewMediaAssetId, sources.older.media.id);
        assert.equal(ordinaryAfter.story.decisions.length, 0);
      } else {
        assert.equal(ordinaryAfter.story.status, "PUBLISHED");
        assert.ok(ordinaryAfter.story.publishedAt);
        assert.equal(ordinaryAfter.story.decisions.length, 1);
        assert.equal(ordinaryAfter.story.decisions[0].action, "PUBLISH");
      }

      const raced = await createStory(`raced ${caseName}`, scenario, sources.older.media.id);
      const before = await snapshot(raced.id);
      let entered;
      let release;
      const started = new Promise((resolve) => { entered = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      // Real C3 source/evidence locks, then a synthetic new submission marker.
      // No assertion is made about the complete C3 HTTP approval workflow.
      const work = db.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await lockCorrectionsStaffRenderSources(tx, { organisationId, render: sources.newer.render });
        await lockCorrectionsStaffRenderEvidence(tx, sources.newer.render);
        await tx.correctionsSubmission.create({ data: {
          programmeId: sources.programme.id, organisationId, facilityId: facility.id,
          revision: 1, renderId: sources.newer.render.id,
          sourceFingerprint: createHash("sha256").update(`${suffix}:${caseName}`).digest("hex"),
          organisationPolicyVersion: 1, facilityPolicyVersion: 1,
          titleSnapshot: sources.programme.title,
          evidenceSnapshot: { mediaAssetId: sources.newer.media.id, promoVersionId: sources.newer.promoVersion.id },
          submittedByUserId: userId
        } });
        await tx.correctionsProgramme.update({ where: { id: sources.programme.id }, data: { status: "SUBMITTED", latestRevision: 1 } });
        entered(pid);
        await gate;
      }, { isolationLevel: "Serializable", timeout: 25_000 });
      heldTransition = { work, release, pid: null };
      heldTransition.pid = await Promise.race([
        started, work.then(() => { throw new Error("The newer C3 Newsroom fixture finished before holding its project lock."); })
      ]);
      let settled = false;
      pendingRequest = api(path, cookie, mutation(scenario, raced.id, sources.older.media.id)).finally(() => { settled = true; });
      pendingRequest.catch(() => {});
      let waitError;
      try {
        await waitForNewsroomProjectLocks(db, heldTransition.pid, () => settled, 1);
      } catch (error) {
        waitError = error;
      } finally {
        heldTransition.release();
      }
      await heldTransition.work;
      heldTransition = null;
      const denied = await pendingRequest;
      pendingRequest = null;
      const responseText = await denied.clone().text();
      if (waitError) throw new Error(`${caseName}: ${waitError.message} HTTP ${denied.status}: ${responseText}`);
      assert.equal(denied.status, 409, `${caseName}: ${responseText}`);
      assert.deepEqual(await snapshot(raced.id), before, `${caseName} must preserve story, revisions, decisions, audits and episode/rundown state.`);
    }
  } finally {
    heldTransition?.release();
    await heldTransition?.work.catch(() => {});
    await pendingRequest?.catch(() => {});
    try {
      if (organisationId) {
        await db.newsStoryDecision.deleteMany({ where: { organisationId } });
        await db.newsStoryRevision.deleteMany({ where: { organisationId } });
        await db.schoolNewsStory.deleteMany({ where: { organisationId } });
        await db.schoolRundownItem.deleteMany({ where: { rundown: { organisationId } } });
        await db.schoolRundown.deleteMany({ where: { organisationId } });
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioProjectVersion.deleteMany({ where: { project: { organisationId } } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.promoAsset.updateMany({ where: { organisationId }, data: { currentApprovedVersionId: null } });
        await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId } } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.schoolEpisode.deleteMany({ where: { organisationId } });
        await db.schoolProgramme.deleteMany({ where: { organisationId } });
        await db.staffSupervisor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.correctionsFacility.deleteMany({ where: { location: { organisationId } } });
        await db.location.deleteMany({ where: { organisationId } });
        await db.station.deleteMany({ where: { organisationId } });
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

test("School and Online Newsroom CREATE reject targets made private while the write waits", async () => {
  if (!ciDatabase) throw new Error("C9 Newsroom CREATE integration runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let held;
  try {
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 Newsroom CREATE ${suffix}`, slug: `c9-news-create-${suffix}`
    } });
    organisationId = organisation.id;
    const user = await db.user.create({ data: {
      email: `c9-news-create-${suffix}@example.invalid`, passwordHash: "CI-only-not-a-login", role: "OWNER"
    } });
    userId = user.id;
    const station = await db.station.create({ data: {
      organisationId, productFamily: "ONLINE", name: "Ordinary Online target",
      slug: `c9-news-create-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const channel = await db.channel.create({ data: {
      organisationId, stationId: station.id, name: "Ordinary channel",
      slug: `c9-news-create-channel-${suffix}`, status: "ACTIVE", musicRightsUse: "ONLINE_RADIO"
    } });
    const onlineChannelWhere = {
      OR: [{ musicRightsUse: null }, { musicRightsUse: { not: "CORRECTIONS_RADIO" } }],
      station: { is: GENERAL_STATION_MANAGEMENT_WHERE }
    };
    const onlineTargets = { organisationId, stationId: station.id, channelId: channel.id,
      stationWhere: GENERAL_STATION_MANAGEMENT_WHERE, channelWhere: onlineChannelWhere };
    assert.equal(await db.$transaction((tx) => lockVisibleOnlineNewsroomCreateTargets(tx, onlineTargets),
      { isolationLevel: "ReadCommitted" }), true);

    let entered;
    let release;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const work = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "Station" WHERE "id" = ${station.id} FOR UPDATE`;
      await tx.channel.update({ where: { id: channel.id }, data: { musicRightsUse: "CORRECTIONS_RADIO" } });
      entered(pid);
      await gate;
    }, { timeout: 25_000 });
    held = { work, release, pid: await Promise.race([
      started, work.then(() => { throw new Error("The Online target transition finished too early."); })
    ]) };
    let settled = false;
    const pending = db.$transaction(async (tx) => {
      if (!await lockVisibleOnlineNewsroomCreateTargets(tx, onlineTargets)) return false;
      await tx.schoolNewsStory.create({ data: { organisationId, product: "ONLINE_RADIO",
        stationId: station.id, channelId: channel.id, title: "Should not be created Online",
        type: "NEWS_BULLETIN", createdByUserId: userId } });
      return true;
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 }).then(
      (value) => ({ value }), (error) => ({ error })
    ).finally(() => { settled = true; });
    let waitError;
    try { await waitForCreateTargetLock(db, held.pid, "Station", () => settled); }
    catch (error) { waitError = error; }
    finally { held.release(); }
    await held.work;
    held = null;
    const onlineDecision = await pending;
    if (waitError) throw waitError;
    if (onlineDecision.error) throw onlineDecision.error;
    assert.equal(onlineDecision.value, false);
    assert.equal(await db.schoolNewsStory.count({ where: { organisationId } }), 0);

    const supervisor = await db.staffSupervisor.create({ data: { organisationId, userId } });
    const schoolProgramme = await db.schoolProgramme.create({ data: {
      organisationId, supervisorId: supervisor.id, title: "Ordinary School programme", createdByUserId: userId
    } });
    const episode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: schoolProgramme.id, title: "Ordinary School episode", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, episodeId: episode.id, title: "School source later made private",
      editDecision: {}, createdByUserId: userId
    } });
    const media = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "School source recording",
      originalName: "school-source.mp3", storageKey: `c9-news-create/${suffix}/school-source.mp3`,
      mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
      mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    const take = await db.audioTake.create({ data: {
      organisationId, projectId: project.id, mediaAssetId: media.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });
    await db.schoolRundown.create({ data: {
      organisationId, episodeId: episode.id, createdByUserId: userId,
      items: { create: { type: "VOICE_TRACK", position: 0, label: "School voice", sourceTakeId: take.id } }
    } });
    const schoolTargets = { organisationId, programmeId: schoolProgramme.id, episodeId: episode.id };
    assert.equal(await db.$transaction((tx) => lockVisibleSchoolNewsroomCreateTargets(tx, schoolTargets),
      { isolationLevel: "ReadCommitted" }), true);
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-news-create-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const correctionsProgramme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Private programme", createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor", createdByUserId: userId
    } });
    entered = null; release = null;
    const schoolStarted = new Promise((resolve) => { entered = resolve; });
    const schoolGate = new Promise((resolve) => { release = resolve; });
    const schoolWork = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${project.id} FOR UPDATE`;
      await tx.correctionsStudioSession.create({ data: {
        organisationId, facilityId: facility.id, contributorId: contributor.id,
        programmeId: correctionsProgramme.id, projectId: project.id,
        supervisorUserId: userId, createdByUserId: userId,
        capabilityScope: { purpose: "CI-only Newsroom CREATE race" }
      } });
      entered(pid);
      await schoolGate;
    }, { timeout: 25_000 });
    held = { work: schoolWork, release, pid: await Promise.race([
      schoolStarted, schoolWork.then(() => { throw new Error("The School source transition finished too early."); })
    ]) };
    settled = false;
    const pendingSchool = db.$transaction(async (tx) => {
      if (!await lockVisibleSchoolNewsroomCreateTargets(tx, schoolTargets)) return false;
      await tx.schoolNewsStory.create({ data: { organisationId, product: "SCHOOL_RADIO",
        programmeId: schoolProgramme.id, episodeId: episode.id,
        title: "Should not be created School", type: "NEWS_BULLETIN", createdByUserId: userId } });
      return true;
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 }).then(
      (value) => ({ value }), (error) => ({ error })
    ).finally(() => { settled = true; });
    waitError = null;
    try { await waitForCreateTargetLock(db, held.pid, "AudioProject", () => settled); }
    catch (error) { waitError = error; }
    finally { held.release(); }
    await held.work;
    held = null;
    const schoolDecision = await pendingSchool;
    if (waitError) throw waitError;
    if (schoolDecision.error) throw schoolDecision.error;
    assert.equal(schoolDecision.value, false);
    assert.equal(await db.schoolNewsStory.count({ where: { organisationId } }), 0);
  } finally {
    if (held) {
      held.release();
      await held.work.catch(() => {});
    }
    try {
      if (organisationId) {
        await db.newsStoryDecision.deleteMany({ where: { organisationId } });
        await db.schoolNewsStory.deleteMany({ where: { organisationId } });
        await db.schoolRundownItem.deleteMany({ where: { rundown: { organisationId } } });
        await db.schoolRundown.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.schoolEpisode.deleteMany({ where: { organisationId } });
        await db.schoolProgramme.deleteMany({ where: { organisationId } });
        await db.staffSupervisor.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.channel.deleteMany({ where: { organisationId } });
        await db.station.deleteMany({ where: { organisationId } });
        await db.correctionsFacility.deleteMany({ where: { location: { organisationId } } });
        await db.location.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  }
});
