import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "../../lib/studio-general-asset-boundary.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", cache: "no-store" });
}

test("public School podcast delivery withdraws audio later submitted to private Inside review", async () => {
  if (!ciDatabase) {
    throw new Error("C9 public School podcast integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 School podcast ${suffix}`, code: `C9_SCHOOL_PODCAST_${suffix}`,
      productFamily: "SCHOOL", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      schoolRadioEnabled: true, schoolPublicPublishingEnabled: true, correctionsRadioEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 School podcast ${suffix}`, slug: `c9-school-podcast-${suffix}`
    } });
    organisationId = organisation.id;
    const user = await db.user.create({ data: {
      email: `c9-school-podcast-${suffix}@example.invalid`, passwordHash: "CI-only-not-a-login", role: "OWNER"
    } });
    userId = user.id;
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    await db.schoolProfile.create({ data: { organisationId, publishingPolicy: "PUBLIC" } });
    await db.schoolSafeguardingReadiness.create({ data: { organisationId, status: "APPROVED" } });
    const supervisor = await db.staffSupervisor.create({ data: { organisationId, userId } });
    const programme = await db.schoolProgramme.create({ data: {
      organisationId, supervisorId: supervisor.id, title: `Fictional School programme ${suffix}`,
      createdByUserId: userId
    } });
    const series = await db.schoolPodcastSeries.create({ data: {
      organisationId, product: "SCHOOL_RADIO", title: `Fictional School series ${suffix}`,
      publicationScope: "PUBLIC", rssEnabled: true, createdByUserId: userId
    } });

    async function publishedEpisode(label) {
      const episode = await db.schoolEpisode.create({ data: {
        organisationId, programmeId: programme.id, title: `Fictional ${label} episode`,
        status: "APPROVED", approvedAt: new Date(), createdByUserId: userId
      } });
      const media = await db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name: `Fictional ${label} audio`,
        originalName: `${label}.mp3`, storageKey: `ci-only-school-podcast/${suffix}/${label}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
      const promo = await db.promoAsset.create({ data: {
        organisationId, name: `Fictional ${label} promo`, mediaType: "ANNOUNCEMENT"
      } });
      const promoVersion = await db.promoVersion.create({ data: {
        promoAssetId: promo.id, mediaAssetId: media.id, version: 1,
        status: "APPROVED", qcStatus: "PASSED", durationSeconds: 20
      } });
      await db.schoolSubmission.create({ data: {
        organisationId, episodeId: episode.id, promoVersionId: promoVersion.id,
        revision: 1, status: "SUBMITTED", submittedByUserId: userId
      } });
      const podcast = await db.schoolPodcastEpisode.create({ data: {
        organisationId, seriesId: series.id, episodeId: episode.id,
        status: "PUBLISHED", publicationScope: "PUBLIC", publishedAt: new Date(),
        createdByUserId: userId, reviewedByUserId: userId
      } });
      await db.transcript.create({ data: {
        organisationId, podcastEpisodeId: podcast.id, episodeId: episode.id,
        segmentsJson: [{ startMs: 0, endMs: 1000, text: `Fictional ${label} transcript` }],
        status: "APPROVED"
      } });
      return { episode, media, promoVersion, podcast };
    }

    const ordinary = await publishedEpisode("ordinary");
    const laterPrivate = await publishedEpisode("later-private");
    const listingPath = `/api/public/school-radio/${organisation.slug}/episodes`;
    const before = await api(listingPath);
    assert.equal(before.status, 200, await before.clone().text());
    assert.equal(before.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Set((await before.json()).episodes.map(({ id }) => id)),
      new Set([ordinary.podcast.id, laterPrivate.podcast.id]));

    const project = await db.audioProject.create({ data: {
      organisationId, episodeId: laterPrivate.episode.id, title: "Fictional ordinary Studio project",
      type: "MULTITRACK", editDecision: {}, createdByUserId: userId
    } });
    const version = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, state: {}, createdByUserId: userId
    } });
    const render = await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: version.id,
      outputMediaAssetId: laterPrivate.media.id,
      outputPromoVersionId: laterPrivate.promoVersion.id,
      requestedByUserId: userId, preset: "SCHOOL_RADIO_MP3", status: "SUCCEEDED"
    } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-podcast-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const insideProgramme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional Inside programme",
      createdByUserId: userId
    } });
    await db.correctionsSubmission.create({ data: {
      organisationId, facilityId: facility.id, programmeId: insideProgramme.id,
      renderId: render.id, revision: 1, sourceFingerprint: "ci-only-school-podcast-transition",
      organisationPolicyVersion: 1, facilityPolicyVersion: 1,
      titleSnapshot: "Fictional Inside programme", evidenceSnapshot: {}, submittedByUserId: userId
    } });

    assert.equal(await db.mediaAsset.count({ where: {
      id: ordinary.media.id, organisationId, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE
    } }), 1, "the ordinary control asset must stay eligible");
    assert.equal(await db.mediaAsset.count({ where: {
      id: laterPrivate.media.id, organisationId, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE
    } }), 0, "the Corrections submission must make its render output private");

    const after = await api(listingPath);
    assert.equal(after.status, 200, await after.clone().text());
    assert.equal(after.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await after.json()).episodes.map(({ id }) => id), [ordinary.podcast.id],
      "public metadata must omit the formerly public private episode");
    const audio = await api(`/api/public/school-radio/${organisation.slug}/episodes/${laterPrivate.podcast.id}/audio`);
    assert.equal(audio.status, 404, "the direct public audio URL must stop before object storage");
    assert.equal(audio.headers.get("cache-control"), "private, no-store");
  } finally {
    try {
      if (organisationId) {
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.schoolPublicationDailyAggregate.deleteMany({ where: { organisationId } });
        await db.transcript.deleteMany({ where: { organisationId } });
        await db.schoolPodcastEpisode.deleteMany({ where: { organisationId } });
        await db.schoolPodcastSeries.deleteMany({ where: { organisationId } });
        await db.schoolSubmission.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioProjectVersion.deleteMany({ where: { project: { organisationId } } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId } } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.schoolEpisode.deleteMany({ where: { organisationId } });
        await db.schoolProgramme.deleteMany({ where: { organisationId } });
        await db.staffSupervisor.deleteMany({ where: { organisationId } });
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
