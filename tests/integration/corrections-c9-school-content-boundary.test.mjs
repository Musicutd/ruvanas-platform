import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  generalSchoolNewsStoryWhere,
  generalSchoolRundownWhere
} from "../../lib/school-general-content-boundary.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

test("School content queries hide historical Corrections rundown and newsroom links", async () => {
  if (!ciDatabase) throw new Error("C9 School content integration runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
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
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: contributor.id,
      programmeId: correctionsProgramme.id, projectId: privateProject.id,
      supervisorUserId: userId, createdByUserId: userId,
      capabilityScope: { purpose: "isolated CI-only privacy test" }
    } });

    const after = await visible();
    assert.deepEqual(after.rundowns, new Set([normalRundown.id]));
    assert.deepEqual(after.stories, new Set([normalStory.id]));
    assert.equal(await db.schoolRundown.count({ where: { id: privateRundown.id, organisationId, ...generalSchoolRundownWhere(organisationId) } }), 0);
    assert.equal(await db.schoolNewsStory.count({ where: { id: oldProjectStory.id, organisationId, ...generalSchoolNewsStoryWhere(organisationId) } }), 0);
    assert.equal(await db.schoolNewsStory.count({ where: { id: oldMediaStory.id, organisationId, ...generalSchoolNewsStoryWhere(organisationId) } }), 0);
    assert.equal(await db.schoolNewsStory.count({ where: { id: oldEpisodeStory.id, organisationId, ...generalSchoolNewsStoryWhere(organisationId) } }), 0);
  } finally {
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
