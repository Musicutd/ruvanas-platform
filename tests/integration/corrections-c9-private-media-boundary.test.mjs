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
    method, headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: "manual"
  });
}

test("same-org generic media routes hide supervised and submitted Inside media, including library metadata", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 private media integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 media ${suffix}`, code: `C9_MEDIA_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128, onlineRadioEnabled: true, stationLimit: 1
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 private media ${suffix}`, slug: `c9-private-media-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-private-media-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional protected facility", slug: `c9-media-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional programme", createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional supervised project", editDecision: {}, createdByUserId: userId
    } });
    const protectedMedia = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional protected take",
      originalName: "fictional-protected.mp3", storageKey: `c9-private-media/${suffix}/protected.mp3`,
      mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
      mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: contributor.id,
      programmeId: programme.id, projectId: project.id, supervisorUserId: userId,
      createdByUserId: userId, capabilityScope: { purpose: "CI-only" }
    } });
    await db.audioTake.create({ data: {
      organisationId, projectId: project.id, mediaAssetId: protectedMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });

    async function libraryMedia(name) {
      return db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name,
        originalName: `${name}.mp3`, storageKey: `c9-private-media/${suffix}/${name}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
    }
    const ordinaryMedia = await libraryMedia("fictional-ordinary-audio");
    const supervisedOutput = await libraryMedia("fictional-supervised-output");
    const submittedOutput = await libraryMedia("fictional-submitted-output");
    const ordinaryPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional ordinary promo", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: ordinaryMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED", qcNotes: "Ordinary QC note" } }
    } });
    const mixedPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional private mixed-version promo", mediaType: "ANNOUNCEMENT",
      versions: { create: [
        { mediaAssetId: ordinaryMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED" },
        { mediaAssetId: supervisedOutput.id, version: 2, status: "IN_REVIEW", qcNotes: "Private supervised QC note" }
      ] }
    }, include: { versions: true } });
    await db.promoAsset.update({ where: { id: mixedPromo.id }, data: {
      currentApprovedVersionId: mixedPromo.versions.find((version) => version.version === 1).id
    } });
    const submittedPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional historical submitted promo", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: submittedOutput.id, version: 1, status: "IN_REVIEW", qcNotes: "Private submitted QC note" } }
    }, include: { versions: true } });
    const supervisedVersion = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, state: {}, createdByUserId: userId
    } });
    await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: supervisedVersion.id,
      outputMediaAssetId: supervisedOutput.id,
      outputPromoVersionId: mixedPromo.versions.find((version) => version.version === 2).id,
      requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });
    const historicalProject = await db.audioProject.create({ data: {
      organisationId, title: "Fictional ordinary project with submitted history", editDecision: {}, createdByUserId: userId
    } });
    const historicalVersion = await db.audioProjectVersion.create({ data: {
      projectId: historicalProject.id, version: 1, state: {}, createdByUserId: userId
    } });
    const submittedRender = await db.audioRender.create({ data: {
      organisationId, projectId: historicalProject.id, versionId: historicalVersion.id,
      outputMediaAssetId: submittedOutput.id,
      outputPromoVersionId: submittedPromo.versions[0].id,
      requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });
    await db.correctionsSubmission.create({ data: {
      programmeId: programme.id, organisationId, facilityId: facility.id,
      revision: 1, renderId: submittedRender.id, sourceFingerprint: "fictional-ci-source",
      organisationPolicyVersion: 1, facilityPolicyVersion: 1,
      titleSnapshot: "Fictional private submitted work", evidenceSnapshot: {}, submittedByUserId: userId
    } });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const stream = await api(`/api/media/${protectedMedia.id}/stream`, { cookie });
    assert.equal(stream.status, 404, await stream.clone().text());
    const remove = await api(`/api/media/${protectedMedia.id}`, { method: "DELETE", cookie });
    assert.equal(remove.status, 403, await remove.clone().text());
    assert.ok(await db.mediaAsset.findUnique({ where: { id: protectedMedia.id } }));
    const library = await api("/api/media/library", { cookie });
    assert.equal(library.status, 200, await library.clone().text());
    const libraryJson = await library.json();
    assert.deepEqual(libraryJson.assets.map(({ id }) => id), [ordinaryPromo.id]);
    assert.equal(libraryJson.assets[0].versions[0].file.name, ordinaryMedia.originalName);
    for (const secret of [mixedPromo.name, submittedPromo.name, supervisedOutput.originalName, submittedOutput.originalName,
      "Private supervised QC note", "Private submitted QC note", mixedPromo.versions[0].id]) {
      assert.ok(!JSON.stringify(libraryJson).includes(secret), `Library leaked ${secret}`);
    }
  } finally {
    try {
      if (organisationId) {
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
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

test("C3 staff render choices and direct submissions cannot reuse another facility's private render", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 staff-render integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let planId;
  const userIds = [];
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 staff render ${suffix}`, code: `C9_STAFF_RENDER_${suffix}`,
      productFamily: "CORRECTIONS", tierNumber: 2, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128, correctionsRadioEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 staff render ${suffix}`, slug: `c9-staff-render-${suffix}`
    } });
    organisationId = organisation.id;
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    await db.correctionsProfile.create({ data: { organisationId, policyConfiguredAt: new Date() } });
    const password = `CI-only-${randomUUID()}!`;
    async function member(role, name) {
      const user = await db.user.create({ data: {
        name, email: `c9-${role.toLowerCase()}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 4), role
      } });
      userIds.push(user.id);
      const membership = await db.organisationMember.create({ data: { organisationId, userId: user.id, role } });
      return { user, membership };
    }
    const owner = await member("OWNER", "Fictional owner");
    const manager = await member("MANAGER", "Fictional A manager");
    const managerB = await db.user.create({ data: {
      name: "Fictional B manager", email: `c9-manager-b-${suffix}@example.invalid`,
      passwordHash: await bcrypt.hash(password, 4), role: "MANAGER"
    } });
    userIds.push(managerB.id);
    const managerBMembership = await db.organisationMember.create({ data: {
      organisationId, userId: managerB.id, role: "MANAGER"
    } });
    const unassignedManager = await db.user.create({ data: {
      name: "Fictional unassigned manager", email: `c9-manager-unassigned-${suffix}@example.invalid`,
      passwordHash: await bcrypt.hash(password, 4), role: "MANAGER"
    } });
    userIds.push(unassignedManager.id);
    await db.organisationMember.create({ data: {
      organisationId, userId: unassignedManager.id, role: "MANAGER"
    } });
    const viewer = await member("VIEWER", "Fictional unassigned viewer");
    const facilityA = await db.location.create({ data: {
      organisationId, name: "Fictional facility A", slug: `c9-facility-a-${suffix}`,
      countryCode: "MT", status: "ACTIVE", correctionsFacility: { create: { policyConfiguredAt: new Date() } }
    } });
    const facilityB = await db.location.create({ data: {
      organisationId, name: "Fictional facility B", slug: `c9-facility-b-${suffix}`,
      countryCode: "MT", status: "ACTIVE", correctionsFacility: { create: { policyConfiguredAt: new Date() } }
    } });
    await db.correctionsFacilityGrant.create({ data: {
      organisationId, organisationMemberId: manager.membership.id, facilityId: facilityA.id,
      permission: "MANAGER", createdByUserId: owner.user.id
    } });
    await db.correctionsFacilityGrant.create({ data: {
      organisationId, organisationMemberId: managerBMembership.id, facilityId: facilityB.id,
      permission: "MANAGER", createdByUserId: owner.user.id
    } });
    const programmeA = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facilityA.id, title: "Fictional A programme", createdByUserId: manager.user.id
    } });
    const programmeB = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facilityB.id, title: "Fictional B programme", createdByUserId: owner.user.id
    } });
    async function approvedRender(title, checksum, priorProjectId = null) {
      const project = priorProjectId ? await db.audioProject.update({
        where: { id: priorProjectId }, data: { currentVersion: 2 }
      }) : await db.audioProject.create({ data: {
        organisationId, title, editDecision: {}, createdByUserId: owner.user.id
      } });
      const projectVersion = await db.audioProjectVersion.create({ data: {
        projectId: project.id, version: priorProjectId ? 2 : 1, state: {}, createdByUserId: owner.user.id
      } });
      const media = await db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name: title,
        originalName: `${title}.mp3`, storageKey: `c9-staff-render/${suffix}/${checksum}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
      const promo = await db.promoAsset.create({ data: {
        organisationId, name: title, mediaType: "ANNOUNCEMENT",
        versions: { create: { mediaAssetId: media.id, version: 1, status: "APPROVED",
          qcStatus: "PASSED", checksumSha256: checksum } }
      }, include: { versions: true } });
      await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: promo.versions[0].id } });
      const render = await db.audioRender.create({ data: {
        organisationId, projectId: project.id, versionId: projectVersion.id,
        outputMediaAssetId: media.id, outputPromoVersionId: promo.versions[0].id,
        requestedByUserId: owner.user.id, preset: "SPEECH_MP3", status: "SUCCEEDED",
        completedAt: new Date(), resultJson: { checksumSha256: checksum }
      } });
      return { render, projectId: project.id, promoVersionId: promo.versions[0].id };
    }
    const ordinary = await approvedRender("Fictional unassociated render", "a".repeat(64));
    const privateB = await approvedRender("Fictional B private render", "b".repeat(64));
    const sourceMedia = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional reusable A source",
      originalName: "fictional-a-source.mp3", storageKey: `c9-staff-render/${suffix}/source.mp3`,
      mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
      mediaType: "JINGLE", status: "READY"
    } });
    const sourcePromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional reusable A source", mediaType: "JINGLE",
      versions: { create: { mediaAssetId: sourceMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED" } }
    }, include: { versions: true } });
    await db.promoAsset.update({ where: { id: sourcePromo.id }, data: {
      currentApprovedVersionId: sourcePromo.versions[0].id
    } });
    await db.correctionsSubmission.create({ data: {
      programmeId: programmeB.id, organisationId, facilityId: facilityB.id,
      revision: 1, renderId: privateB.render.id, sourceFingerprint: "fictional-b-evidence",
      organisationPolicyVersion: 1, facilityPolicyVersion: 1,
      titleSnapshot: programmeB.title, evidenceSnapshot: { mediaAssetId: privateB.render.outputMediaAssetId },
      submittedByUserId: owner.user.id
    } });
    await db.correctionsProgramme.update({ where: { id: programmeB.id }, data: {
      status: "CHANGES_REQUESTED", latestRevision: 1
    } });
    const revisedB = await approvedRender("Fictional B revised render", "c".repeat(64), privateB.projectId);
    async function cookieFor(user) {
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(login.status, 200, await login.clone().text());
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return cookie;
    }
    const managerCookie = await cookieFor(manager.user);
    const managerBCookie = await cookieFor(managerB);
    const unassignedManagerCookie = await cookieFor(unassignedManager);
    const viewerCookie = await cookieFor(viewer.user);
    const aList = await api("/api/corrections/programmes", { cookie: managerCookie });
    assert.equal(aList.status, 200, await aList.clone().text());
    const aPayload = await aList.json();
    assert.ok(aPayload.renders.some(({ id }) => id === ordinary.render.id));
    assert.ok(!aPayload.renders.some(({ id }) => id === privateB.render.id || id === revisedB.render.id));
    assert.ok(!JSON.stringify(aPayload).includes("Fictional B private render"));
    const bList = await api("/api/corrections/programmes", { cookie: managerBCookie });
    assert.equal(bList.status, 200, await bList.clone().text());
    assert.ok((await bList.json()).renders.some(({ id }) => id === revisedB.render.id));
    for (const cookie of [viewerCookie, unassignedManagerCookie]) {
      const response = await api("/api/corrections/programmes", { cookie });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual((await response.json()).renders, []);
    }
    const sourceList = await api("/api/corrections/studio-sessions", { cookie: managerCookie });
    assert.equal(sourceList.status, 200, await sourceList.clone().text());
    const sources = (await sourceList.json()).approvedSources;
    assert.ok(sources.some(({ id }) => id === ordinary.promoVersionId));
    assert.ok(sources.some(({ id }) => id === sourcePromo.versions[0].id));
    assert.ok(!sources.some(({ id }) => id === privateB.promoVersionId || id === revisedB.promoVersionId));
    const unassignedSources = await api("/api/corrections/studio-sessions", { cookie: unassignedManagerCookie });
    assert.equal(unassignedSources.status, 200, await unassignedSources.clone().text());
    assert.deepEqual((await unassignedSources.json()).approvedSources, []);
    const contributorA = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facilityA.id, displayName: "Fictional A contributor",
      createdByUserId: manager.user.id
    } });
    const sessionProject = await db.audioProject.create({ data: {
      organisationId, title: "Fictional A supervised project", editDecision: {}, createdByUserId: manager.user.id
    } });
    const sessionA = await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facilityA.id, contributorId: contributorA.id,
      programmeId: programmeA.id, projectId: sessionProject.id,
      supervisorUserId: manager.user.id, createdByUserId: manager.user.id,
      capabilityScope: ["RECORD", "EDIT", "RENDER", "SUBMIT"]
    } });
    const attachedPrivate = await api(`/api/corrections/studio-sessions/${sessionA.id}/sources`, {
      method: "POST", cookie: managerCookie, body: { promoVersionId: privateB.promoVersionId }
    });
    assert.equal(attachedPrivate.status, 404, await attachedPrivate.clone().text());
    assert.equal(await db.audioTake.count({ where: { projectId: sessionProject.id } }), 0);
    const attachedOwnSource = await api(`/api/corrections/studio-sessions/${sessionA.id}/sources`, {
      method: "POST", cookie: managerCookie, body: { promoVersionId: sourcePromo.versions[0].id }
    });
    assert.equal(attachedOwnSource.status, 200, await attachedOwnSource.clone().text());
    const aSourcesAfterAttach = await api("/api/corrections/studio-sessions", { cookie: managerCookie });
    assert.equal(aSourcesAfterAttach.status, 200, await aSourcesAfterAttach.clone().text());
    assert.ok((await aSourcesAfterAttach.json()).approvedSources.some(({ id }) => id === sourcePromo.versions[0].id));
    const bSourcesAfterAttach = await api("/api/corrections/studio-sessions", { cookie: managerBCookie });
    assert.equal(bSourcesAfterAttach.status, 200, await bSourcesAfterAttach.clone().text());
    assert.ok(!(await bSourcesAfterAttach.json()).approvedSources.some(({ id }) => id === sourcePromo.versions[0].id));
    const secondAProject = await db.audioProject.create({ data: {
      organisationId, title: "Fictional second A supervised project", editDecision: {}, createdByUserId: manager.user.id
    } });
    const secondASession = await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facilityA.id, contributorId: contributorA.id,
      programmeId: programmeA.id, projectId: secondAProject.id,
      supervisorUserId: manager.user.id, createdByUserId: manager.user.id,
      capabilityScope: ["RECORD", "EDIT", "RENDER", "SUBMIT"]
    } });
    const attachAgainAtA = await api(`/api/corrections/studio-sessions/${secondASession.id}/sources`, {
      method: "POST", cookie: managerCookie, body: { promoVersionId: sourcePromo.versions[0].id }
    });
    assert.equal(attachAgainAtA.status, 200, await attachAgainAtA.clone().text());
    assert.equal(await db.audioTake.count({ where: { projectId: secondAProject.id, promoVersionId: sourcePromo.versions[0].id } }), 1);
    const contributorB = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facilityB.id, displayName: "Fictional B contributor",
      createdByUserId: managerB.id
    } });
    const bSessionProject = await db.audioProject.create({ data: {
      organisationId, title: "Fictional B supervised project", editDecision: {}, createdByUserId: managerB.id
    } });
    const sessionB = await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facilityB.id, contributorId: contributorB.id,
      programmeId: programmeB.id, projectId: bSessionProject.id,
      supervisorUserId: managerB.id, createdByUserId: managerB.id,
      capabilityScope: ["RECORD", "EDIT", "RENDER", "SUBMIT"]
    } });
    const attachAUsedSourceAtB = await api(`/api/corrections/studio-sessions/${sessionB.id}/sources`, {
      method: "POST", cookie: managerBCookie, body: { promoVersionId: sourcePromo.versions[0].id }
    });
    assert.equal(attachAUsedSourceAtB.status, 404, await attachAUsedSourceAtB.clone().text());
    assert.equal(await db.audioTake.count({ where: { projectId: bSessionProject.id } }), 0);
    const bypass = await api(`/api/corrections/programmes/${programmeA.id}/submit`, {
      method: "POST", cookie: managerCookie, body: { renderId: privateB.render.id }
    });
    assert.equal(bypass.status, 400, await bypass.clone().text());
    assert.equal(await db.correctionsSubmission.count({ where: { programmeId: programmeA.id } }), 0);
    const revised = await api(`/api/corrections/programmes/${programmeB.id}/submit`, {
      method: "POST", cookie: managerBCookie, body: { renderId: revisedB.render.id }
    });
    assert.equal(revised.status, 201, await revised.clone().text());
    assert.equal(await db.correctionsSubmission.count({ where: { programmeId: programmeB.id, revision: 2, renderId: revisedB.render.id } }), 1);
    const firstSubmission = await api(`/api/corrections/programmes/${programmeA.id}/submit`, {
      method: "POST", cookie: managerCookie, body: { renderId: ordinary.render.id }
    });
    assert.equal(firstSubmission.status, 201, await firstSubmission.clone().text());
    assert.equal(await db.correctionsSubmission.count({ where: { programmeId: programmeA.id, renderId: ordinary.render.id } }), 1);
    // A C3 master may later be used as an approved source in A's supervised
    // Studio. That same-facility use must not prevent a separately versioned
    // C3 revision, while it must not become a shortcut into B or make a C4
    // render eligible for the ordinary C3 handoff.
    const sourceProgrammeA = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facilityA.id, title: "Fictional A source programme",
      createdByUserId: manager.user.id
    } });
    const sourceProjectA = await db.audioProject.create({ data: {
      organisationId, title: "Fictional A source session", editDecision: {}, createdByUserId: manager.user.id
    } });
    const sourceSessionA = await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facilityA.id, contributorId: contributorA.id,
      programmeId: sourceProgrammeA.id, projectId: sourceProjectA.id,
      supervisorUserId: manager.user.id, createdByUserId: manager.user.id,
      capabilityScope: ["RECORD", "EDIT", "RENDER", "SUBMIT"]
    } });
    const attachC3MasterAtA = await api(`/api/corrections/studio-sessions/${sourceSessionA.id}/sources`, {
      method: "POST", cookie: managerCookie, body: { promoVersionId: ordinary.promoVersionId }
    });
    assert.equal(attachC3MasterAtA.status, 200, await attachC3MasterAtA.clone().text());
    await db.correctionsProgramme.update({ where: { id: programmeA.id }, data: {
      status: "CHANGES_REQUESTED", latestRevision: 1
    } });
    await db.audioProject.update({ where: { id: ordinary.projectId }, data: { currentVersion: 2 } });
    const secondVersionA = await db.audioProjectVersion.create({ data: {
      projectId: ordinary.projectId, version: 2, state: {}, createdByUserId: owner.user.id
    } });
    const secondRenderA = await db.audioRender.create({ data: {
      organisationId, projectId: ordinary.projectId, versionId: secondVersionA.id,
      outputMediaAssetId: ordinary.render.outputMediaAssetId,
      outputPromoVersionId: ordinary.promoVersionId,
      requestedByUserId: owner.user.id, preset: "SPEECH_MP3", status: "SUCCEEDED",
      completedAt: new Date(), resultJson: { checksumSha256: "a".repeat(64) }
    } });
    const aRevisionChoices = await api("/api/corrections/programmes", { cookie: managerCookie });
    assert.equal(aRevisionChoices.status, 200, await aRevisionChoices.clone().text());
    assert.ok((await aRevisionChoices.json()).renders.some(({ id }) => id === secondRenderA.id));
    const bRevisionChoices = await api("/api/corrections/programmes", { cookie: managerBCookie });
    assert.equal(bRevisionChoices.status, 200, await bRevisionChoices.clone().text());
    assert.ok(!(await bRevisionChoices.json()).renders.some(({ id }) => id === secondRenderA.id));
    const secondSubmissionA = await api(`/api/corrections/programmes/${programmeA.id}/submit`, {
      method: "POST", cookie: managerCookie, body: { renderId: secondRenderA.id }
    });
    assert.equal(secondSubmissionA.status, 201, await secondSubmissionA.clone().text());
    assert.equal(await db.correctionsSubmission.count({ where: {
      programmeId: programmeA.id, revision: 2, renderId: secondRenderA.id
    } }), 1);
    const supervisedOutput = await approvedRender("Fictional C4 output that must stay private", "d".repeat(64), sourceProjectA.id);
    const aChoicesAfterC4 = await api("/api/corrections/programmes", { cookie: managerCookie });
    assert.equal(aChoicesAfterC4.status, 200, await aChoicesAfterC4.clone().text());
    assert.ok(!(await aChoicesAfterC4.json()).renders.some(({ id }) => id === supervisedOutput.render.id));
    const c3TargetA = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facilityA.id, title: "Fictional separate C3 target",
      createdByUserId: manager.user.id
    } });
    const c4Bypass = await api(`/api/corrections/programmes/${c3TargetA.id}/submit`, {
      method: "POST", cookie: managerCookie, body: { renderId: supervisedOutput.render.id }
    });
    assert.equal(c4Bypass.status, 400, await c4Bypass.clone().text());
    assert.equal(await db.correctionsSubmission.count({ where: { programmeId: c3TargetA.id } }), 0);
  } finally {
    try {
      if (organisationId) {
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
