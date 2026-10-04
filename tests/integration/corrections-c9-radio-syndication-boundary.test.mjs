import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { generalRadioSyndicationDeliveryAllowed } from "../../lib/radio-syndication-general-boundary.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";
const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: baseUrl,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

test("syndication rechecks private media, stations and channels after activation", async () => {
  if (!ciDatabase) throw new Error("C9 syndication integration runs only against the exact disposable CI database.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  const rollback = new Error("Roll back CI-only syndication fixture");
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      const source = await tx.organisation.create({ data: { name: `Fictional source ${suffix}`, slug: `c9-syndication-source-${suffix}` } });
      const target = await tx.organisation.create({ data: { name: `Fictional target ${suffix}`, slug: `c9-syndication-target-${suffix}` } });
      const user = await tx.user.create({ data: { email: `c9-syndication-${suffix}@example.invalid`, passwordHash: "CI-only-not-a-login", role: "OWNER" } });
      async function station(organisationId, name) {
        return tx.station.create({ data: {
          organisationId, productFamily: "ONLINE", name,
          slug: `c9-syndication-${name}-${suffix}`, status: "ACTIVE",
          listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
        } });
      }
      const sourceStation = await station(source.id, "source");
      const targetStation = await station(target.id, "target");
      const sourceChannel = await tx.channel.create({ data: {
        organisationId: source.id, stationId: sourceStation.id, name: "Source channel",
        slug: `c9-syndication-source-channel-${suffix}`, status: "ACTIVE", musicRightsUse: "ONLINE_RADIO"
      } });
      const targetChannel = await tx.channel.create({ data: {
        organisationId: target.id, stationId: targetStation.id, name: "Target channel",
        slug: `c9-syndication-target-channel-${suffix}`, status: "ACTIVE", musicRightsUse: "ONLINE_RADIO"
      } });
      const asset = await tx.mediaAsset.create({ data: {
        organisationId: source.id, libraryType: "ORGANISATION_PROMO", name: "Ordinary programme",
        originalName: "ordinary-programme.mp3", storageKey: `c9-syndication/${suffix}/programme.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
      const promo = await tx.promoAsset.create({ data: {
        organisationId: source.id, name: "Programme master", mediaType: "ANNOUNCEMENT"
      } });
      const version = await tx.promoVersion.create({ data: {
        promoAssetId: promo.id, mediaAssetId: asset.id, version: 1,
        status: "APPROVED", qcStatus: "PASSED"
      } });
      const recorded = {
        targetOrganisationId: target.id, targetStationId: targetStation.id, targetChannelId: targetChannel.id,
        offer: {
          kind: "RECORDED_PROGRAMME", stationNetworkId: "fictional-network", sourceOrganisationId: source.id,
          sourceStationId: sourceStation.id, sourceChannelId: null,
          sourceNetworkAgreement: { stationNetworkId: "fictional-network", stationId: sourceStation.id, stationOrganisationId: source.id },
          sourcePodcastEpisodeId: "fictional-episode",
          sourcePodcastEpisode: {
            id: "fictional-episode", organisationId: source.id,
            series: { stationId: sourceStation.id, channelId: null, product: "ONLINE_RADIO" },
            mediaAsset: { id: asset.id, organisationId: source.id }
          }
        }
      };
      assert.equal(await generalRadioSyndicationDeliveryAllowed(tx, recorded), true);

      const facility = await tx.location.create({ data: {
        organisationId: source.id, name: "Fictional private facility",
        slug: `c9-syndication-facility-${suffix}`, correctionsFacility: { create: {} }
      } });
      const announcement = await tx.correctionsAnnouncement.create({ data: {
        organisationId: source.id, facilityId: facility.id, title: "Private Inside audio",
        mediaAssetId: asset.id, promoVersionId: version.id, createdByUserId: user.id
      } });
      assert.equal(await generalRadioSyndicationDeliveryAllowed(tx, recorded), false,
        "an existing recorded agreement must stop when its audio becomes Inside media");
      await tx.correctionsAnnouncement.delete({ where: { id: announcement.id } });
      assert.equal(await generalRadioSyndicationDeliveryAllowed(tx, recorded), true);

      await tx.station.update({ where: { id: sourceStation.id }, data: { productFamily: "CORRECTIONS" } });
      assert.equal(await generalRadioSyndicationDeliveryAllowed(tx, recorded), false);
      await tx.station.update({ where: { id: sourceStation.id }, data: { productFamily: "ONLINE" } });

      await tx.channel.update({ where: { id: targetChannel.id }, data: { musicRightsUse: "CORRECTIONS_RADIO" } });
      assert.equal(await generalRadioSyndicationDeliveryAllowed(tx, recorded), false);
      await tx.channel.update({ where: { id: targetChannel.id }, data: { musicRightsUse: "ONLINE_RADIO" } });

      const live = { ...recorded, offer: {
        ...recorded.offer, kind: "LIVE_RELAY", sourceChannelId: sourceChannel.id,
        sourceChannel: { id: sourceChannel.id, stationId: sourceStation.id },
        sourcePodcastEpisodeId: null, sourcePodcastEpisode: null
      } };
      assert.equal(await generalRadioSyndicationDeliveryAllowed(tx, live), true);
      await tx.channel.update({ where: { id: sourceChannel.id }, data: { musicRightsUse: "CORRECTIONS_RADIO" } });
      assert.equal(await generalRadioSyndicationDeliveryAllowed(tx, live), false);
      throw rollback;
    }, { timeout: 30000 }), (error) => error === rollback);
  } finally {
    await db.$disconnect();
  }
});

test("syndication hides reclassified source metadata and rejects private source and target choices", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 syndication route integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  const organisationIds = [];
  const userIds = [];
  let planId;
  let networkId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 syndication ${suffix}`, code: `C9_SYNDICATION_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      onlineRadioEnabled: true, stationLimit: 10
    } });
    planId = plan.id;
    async function authority(label) {
      const organisation = await db.organisation.create({ data: {
        name: `Fictional ${label} syndication ${suffix}`, slug: `c9-syndication-${label}-${suffix}`
      } });
      organisationIds.push(organisation.id);
      const password = `CI-only-${randomUUID()}!`;
      const user = await db.user.create({ data: {
        email: `c9-syndication-${label}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
      } });
      userIds.push(user.id);
      await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role: "OWNER" } });
      await db.subscription.create({ data: { organisationId: organisation.id, planId, status: "ACTIVE" } });
      return { organisation, user, password };
    }
    const source = await authority("source");
    const target = await authority("target");
    const network = await db.stationNetwork.create({ data: {
      ownerOrganisationId: source.organisation.id, name: `Fictional network ${suffix}`,
      slug: `c9-syndication-network-${suffix}`, status: "ACTIVE", createdByUserId: source.user.id
    } });
    networkId = network.id;

    async function station(authority, label) {
      const item = await db.station.create({ data: {
        organisationId: authority.organisation.id, productFamily: "ONLINE", name: `${label} ${suffix}`,
        slug: `c9-syndication-${label}-${suffix}`, status: "ACTIVE",
        listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128,
        streamConfig: { create: { streamUrl: `https://example.invalid/${label}/live` } }
      } });
      const membership = await db.stationNetworkAgreement.create({ data: {
        stationNetworkId: network.id, stationId: item.id,
        stationOrganisationId: authority.organisation.id, status: "ACTIVE",
        invitedByUserId: source.user.id
      } });
      return { ...item, membershipId: membership.id };
    }
    async function channel(authority, item, label) {
      return db.channel.create({ data: {
        organisationId: authority.organisation.id, stationId: item.id,
        name: `${label} ${suffix}`, slug: `c9-syndication-${label}-${suffix}`,
        status: "ACTIVE", musicRightsUse: "ONLINE_RADIO"
      } });
    }
    const recordedStation = await station(source, "recorded-source");
    const liveStation = await station(source, "live-source");
    const privateStation = await station(source, "station-source");
    const ordinaryTarget = await station(target, "ordinary-target");
    const reclassifiedTarget = await station(target, "reclassified-target");
    const liveChannel = await channel(source, liveStation, "offered-live-channel");
    const unofferedLiveChannel = await channel(source, liveStation, "unoffered-live-channel");
    const stationChannel = await channel(source, privateStation, "offered-station-channel");
    const unofferedStationChannel = await channel(source, privateStation, "unoffered-station-channel");
    await channel(target, ordinaryTarget, "ordinary-target-channel");
    const targetChannel = await channel(target, reclassifiedTarget, "reclassified-target-channel");

    async function media(label) {
      return db.mediaAsset.create({ data: {
        organisationId: source.organisation.id, libraryType: "ORGANISATION_PROMO",
        name: `${label} ${suffix}`, originalName: `${label}.mp3`,
        storageKey: `c9-syndication/${suffix}/${label}.mp3`, mimeType: "audio/mpeg",
        sizeBytes: 1024n, durationSeconds: 20, mediaType: "ANNOUNCEMENT", status: "READY"
      } });
    }
    const ordinaryMedia = await media("ordinary-programme");
    const privateMedia = await media("later-private-programme");
    const series = await db.schoolPodcastSeries.create({ data: {
      organisationId: source.organisation.id, product: "ONLINE_RADIO",
      stationId: recordedStation.id, title: `Fictional online series ${suffix}`,
      createdByUserId: source.user.id
    } });
    async function episode(label, mediaAssetId) {
      return db.schoolPodcastEpisode.create({ data: {
        organisationId: source.organisation.id, seriesId: series.id, mediaAssetId,
        title: `${label} ${suffix}`, status: "PUBLISHED", publishedAt: new Date(),
        createdByUserId: source.user.id
      } });
    }
    const ordinaryEpisode = await episode("Ordinary episode", ordinaryMedia.id);
    const ordinaryUnofferedEpisode = await episode("Ordinary unoffered episode", ordinaryMedia.id);
    const privateEpisode = await episode("Later private episode", privateMedia.id);
    const privateUnofferedEpisode = await episode("Later private unoffered episode", privateMedia.id);
    const privateDraftEpisode = await episode("Later private draft episode", privateMedia.id);
    const availableFrom = new Date(Date.now() - 60_000);
    const availableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    async function offer(label, stationItem, kind, sourceId, status = "AVAILABLE") {
      return db.radioSyndicationOffer.create({ data: {
        stationNetworkId: network.id, sourceNetworkAgreementId: stationItem.membershipId,
        sourceOrganisationId: source.organisation.id, sourceStationId: stationItem.id,
        kind, ...(kind === "RECORDED_PROGRAMME" ? { sourcePodcastEpisodeId: sourceId } : { sourceChannelId: sourceId }),
        title: `${label} ${suffix}`, description: `Description for ${label} ${suffix}`,
        rightsHolder: `Rights holder for ${label} ${suffix}`, rightsReference: `CI-${suffix}`,
        rightsBasis: "OWNED_MASTER", permittedTerritories: "MT",
        availableFrom, availableUntil, status,
        publishedAt: status === "AVAILABLE" ? new Date() : null,
        createdByUserId: source.user.id
      } });
    }
    const ordinaryOffer = await offer("Ordinary offer", recordedStation, "RECORDED_PROGRAMME", ordinaryEpisode.id);
    const privateRecordedOffer = await offer("Private recorded offer", recordedStation, "RECORDED_PROGRAMME", privateEpisode.id);
    const privateDraftOffer = await offer("Private draft offer", recordedStation, "RECORDED_PROGRAMME", privateDraftEpisode.id, "DRAFT");
    const privateLiveOffer = await offer("Private live offer", liveStation, "LIVE_RELAY", liveChannel.id);
    const privateStationOffer = await offer("Private station offer", privateStation, "LIVE_RELAY", stationChannel.id);
    const privateRecordedAgreement = await db.radioSyndicationAgreement.create({ data: {
      offerId: privateRecordedOffer.id, targetNetworkAgreementId: ordinaryTarget.membershipId,
      targetOrganisationId: target.organisation.id, targetStationId: ordinaryTarget.id,
      requestedTerritories: "MT", requestedFrom: availableFrom, requestedUntil: availableUntil,
      intendedUse: "Fictional CI syndication request for a receiving station.",
      requestedByUserId: target.user.id
    } });
    const ordinaryTargetAgreement = await db.radioSyndicationAgreement.create({ data: {
      offerId: ordinaryOffer.id, targetNetworkAgreementId: reclassifiedTarget.membershipId,
      targetOrganisationId: target.organisation.id, targetStationId: reclassifiedTarget.id,
      targetChannelId: targetChannel.id,
      requestedTerritories: "MT", requestedFrom: availableFrom, requestedUntil: availableUntil,
      intendedUse: "Fictional CI request for a station that may later become private.",
      requestedByUserId: target.user.id
    } });

    async function login(authority) {
      const response = await api("/api/auth/login", {
        method: "POST", body: { email: authority.user.email, password: authority.password }
      });
      assert.equal(response.status, 200, await response.clone().text());
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return cookie;
    }
    const sourceCookie = await login(source);
    const targetCookie = await login(target);
    async function workspace(cookie) {
      const response = await api("/api/radio-syndication", { cookie });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      return response.json();
    }
    const sourceBefore = await workspace(sourceCookie);
    const targetBefore = await workspace(targetCookie);
    const sourceStationIds = new Set(sourceBefore.memberships.map(({ station }) => station.id));
    const sourceEpisodeIds = new Set(sourceBefore.eligibleEpisodes.map(({ id }) => id));
    const targetStationIds = new Set(targetBefore.memberships.map(({ station }) => station.id));
    for (const id of [recordedStation.id, liveStation.id, privateStation.id]) assert.ok(sourceStationIds.has(id));
    for (const id of [ordinaryEpisode.id, privateEpisode.id, privateUnofferedEpisode.id]) assert.ok(sourceEpisodeIds.has(id));
    for (const id of [ordinaryTarget.id, reclassifiedTarget.id]) assert.ok(targetStationIds.has(id));
    for (const id of [ordinaryOffer.id, privateRecordedOffer.id, privateLiveOffer.id, privateStationOffer.id]) {
      assert.ok(targetBefore.offers.some((item) => item.id === id));
    }
    assert.ok(targetBefore.myAgreements.some((item) => item.offerId === privateRecordedOffer.id));
    assert.ok(sourceBefore.offers.find(({ id }) => id === ordinaryOffer.id)?.agreements.some((item) => item.targetStation.id === reclassifiedTarget.id));

    const offerInput = (kind, stationId, sourceId, title) => ({
      action: "CREATE_OFFER", stationNetworkId: network.id, sourceStationId: stationId, kind,
      sourcePodcastEpisodeId: kind === "RECORDED_PROGRAMME" ? sourceId : null,
      sourceChannelId: kind === "LIVE_RELAY" ? sourceId : null,
      title, rightsHolder: "Fictional CI rights holder", rightsReference: `CI-${suffix}`,
      rightsBasis: "OWNED_MASTER", permittedTerritories: "MT",
      availableFrom: availableFrom.toISOString(), availableUntil: availableUntil.toISOString()
    });
    const ordinaryCreate = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: offerInput("RECORDED_PROGRAMME", recordedStation.id, ordinaryUnofferedEpisode.id, `Ordinary created ${suffix}`)
    });
    assert.equal(ordinaryCreate.status, 201, await ordinaryCreate.clone().text());
    const ordinaryCreatedOfferId = (await ordinaryCreate.json()).result.id;
    const ordinaryPublish = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: { action: "CHANGE_OFFER", offerId: ordinaryCreatedOfferId, offerAction: "PUBLISH" }
    });
    assert.equal(ordinaryPublish.status, 200, await ordinaryPublish.clone().text());

    const facility = await db.location.create({ data: {
      organisationId: source.organisation.id, name: `Fictional private facility ${suffix}`,
      slug: `c9-syndication-facility-${suffix}`, correctionsFacility: { create: {} }
    } });
    const promo = await db.promoAsset.create({ data: {
      organisationId: source.organisation.id, name: `Private source master ${suffix}`,
      mediaType: "ANNOUNCEMENT"
    } });
    const version = await db.promoVersion.create({ data: {
      promoAssetId: promo.id, mediaAssetId: privateMedia.id,
      version: 1, status: "APPROVED", qcStatus: "PASSED"
    } });
    await db.correctionsAnnouncement.create({ data: {
      organisationId: source.organisation.id, facilityId: facility.id,
      title: `Fictional Inside audio ${suffix}`, mediaAssetId: privateMedia.id,
      promoVersionId: version.id, createdByUserId: source.user.id
    } });
    const sourceAfterMedia = await workspace(sourceCookie);
    const targetAfterMedia = await workspace(targetCookie);
    assert.ok(sourceAfterMedia.eligibleEpisodes.some(({ id }) => id === ordinaryEpisode.id));
    assert.ok(!sourceAfterMedia.eligibleEpisodes.some(({ id }) => id === privateEpisode.id || id === privateUnofferedEpisode.id));
    assert.ok(targetAfterMedia.offers.some(({ id }) => id === ordinaryOffer.id));
    assert.ok(!targetAfterMedia.offers.some(({ id }) => id === privateRecordedOffer.id));
    assert.doesNotMatch(JSON.stringify(targetAfterMedia), new RegExp(`Private recorded offer ${suffix}`));
    const oldSourceOffer = sourceAfterMedia.offers.find(({ id }) => id === privateRecordedOffer.id);
    assert.equal(oldSourceOffer?.unavailableSource, true);
    assert.doesNotMatch(JSON.stringify(oldSourceOffer), new RegExp(`Private recorded offer ${suffix}`));
    const privateRecordedCreate = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: offerInput("RECORDED_PROGRAMME", recordedStation.id, privateUnofferedEpisode.id, `Blocked recorded ${suffix}`)
    });
    assert.equal(privateRecordedCreate.status, 409, await privateRecordedCreate.clone().text());
    const privateDraftPublish = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: { action: "CHANGE_OFFER", offerId: privateDraftOffer.id, offerAction: "PUBLISH" }
    });
    assert.equal(privateDraftPublish.status, 409, await privateDraftPublish.clone().text());
    assert.equal((await db.radioSyndicationOffer.findUnique({ where: { id: privateDraftOffer.id } })).status, "DRAFT");
    const privateRecordedApprove = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: { action: "DECIDE_REQUEST", agreementId: privateRecordedAgreement.id, decision: "APPROVE" }
    });
    assert.equal(privateRecordedApprove.status, 409, await privateRecordedApprove.clone().text());
    assert.equal((await db.radioSyndicationAgreement.findUnique({ where: { id: privateRecordedAgreement.id } })).status, "PENDING");
    const privateRecordedRequest = await api("/api/radio-syndication", {
      method: "POST", cookie: targetCookie,
      body: {
        action: "REQUEST_ACCESS", offerId: privateRecordedOffer.id,
        targetStationId: reclassifiedTarget.id, targetChannelId: targetChannel.id,
        requestedTerritories: "MT", requestedFrom: availableFrom.toISOString(),
        requestedUntil: availableUntil.toISOString(),
        intendedUse: "Fictional CI request for a private recorded offer."
      }
    });
    assert.ok([404, 409].includes(privateRecordedRequest.status), await privateRecordedRequest.clone().text());
    assert.equal(await db.radioSyndicationAgreement.count({ where: {
      offerId: privateRecordedOffer.id, targetStationId: reclassifiedTarget.id
    } }), 0);
    const privateRecordedWithdraw = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: { action: "CHANGE_OFFER", offerId: privateRecordedOffer.id, offerAction: "WITHDRAW", reason: "Source is unavailable in general syndication." }
    });
    assert.equal(privateRecordedWithdraw.status, 200, await privateRecordedWithdraw.clone().text());
    assert.equal((await db.radioSyndicationOffer.findUnique({ where: { id: privateRecordedOffer.id } })).status, "WITHDRAWN");

    await db.channel.update({ where: { id: liveChannel.id }, data: { musicRightsUse: "CORRECTIONS_RADIO" } });
    const sourceAfterChannel = await workspace(sourceCookie);
    const targetAfterChannel = await workspace(targetCookie);
    assert.ok(!sourceAfterChannel.memberships.some(({ station }) => station.id === liveStation.id));
    assert.ok(sourceAfterChannel.memberships.some(({ station }) => station.id === recordedStation.id));
    assert.ok(!targetAfterChannel.offers.some(({ id }) => id === privateLiveOffer.id));
    assert.doesNotMatch(JSON.stringify(targetAfterChannel), new RegExp(`Private live offer ${suffix}`));
    const privateLiveCreate = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: offerInput("LIVE_RELAY", liveStation.id, unofferedLiveChannel.id, `Blocked live ${suffix}`)
    });
    assert.equal(privateLiveCreate.status, 409, await privateLiveCreate.clone().text());

    await db.station.update({ where: { id: privateStation.id }, data: { productFamily: "CORRECTIONS" } });
    const sourceAfterStation = await workspace(sourceCookie);
    const targetAfterSourceStation = await workspace(targetCookie);
    assert.ok(!sourceAfterStation.memberships.some(({ station }) => station.id === privateStation.id));
    assert.ok(!targetAfterSourceStation.offers.some(({ id }) => id === privateStationOffer.id));
    assert.doesNotMatch(JSON.stringify(targetAfterSourceStation), new RegExp(`Private station offer ${suffix}`));
    const privateStationCreate = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: offerInput("LIVE_RELAY", privateStation.id, unofferedStationChannel.id, `Blocked station ${suffix}`)
    });
    assert.equal(privateStationCreate.status, 409, await privateStationCreate.clone().text());

    const requestInput = { action: "REQUEST_ACCESS", offerId: ordinaryCreatedOfferId,
      targetStationId: reclassifiedTarget.id, targetChannelId: targetChannel.id,
      requestedTerritories: "MT", requestedFrom: availableFrom.toISOString(),
      requestedUntil: availableUntil.toISOString(),
      intendedUse: "Fictional CI request for a reclassified receiving station." };
    const ordinaryApprove = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: { action: "DECIDE_REQUEST", agreementId: ordinaryTargetAgreement.id, decision: "APPROVE" }
    });
    assert.equal(ordinaryApprove.status, 200, await ordinaryApprove.clone().text());
    await db.station.update({ where: { id: reclassifiedTarget.id }, data: { productFamily: "CORRECTIONS" } });
    const targetAfterTargetStation = await workspace(targetCookie);
    const sourceAfterTargetStation = await workspace(sourceCookie);
    assert.ok(targetAfterTargetStation.memberships.some(({ station }) => station.id === ordinaryTarget.id));
    assert.ok(!targetAfterTargetStation.memberships.some(({ station }) => station.id === reclassifiedTarget.id));
    assert.ok(!targetAfterTargetStation.myAgreements.some(({ offerId }) => offerId === ordinaryOffer.id));
    assert.doesNotMatch(JSON.stringify(sourceAfterTargetStation), new RegExp(reclassifiedTarget.name));
    const privateTargetStationRequest = await api("/api/radio-syndication", {
      method: "POST", cookie: targetCookie, body: requestInput
    });
    assert.equal(privateTargetStationRequest.status, 409, await privateTargetStationRequest.clone().text());
    const privateTargetActivation = await api("/api/radio-syndication", {
      method: "POST", cookie: targetCookie,
      body: { action: "ACTIVATE_REQUEST", agreementId: ordinaryTargetAgreement.id }
    });
    assert.equal(privateTargetActivation.status, 409, await privateTargetActivation.clone().text());
    assert.equal((await db.radioSyndicationAgreement.findUnique({ where: { id: ordinaryTargetAgreement.id } })).importedAt, null);
    const privateTargetRevoke = await api("/api/radio-syndication", {
      method: "POST", cookie: sourceCookie,
      body: { action: "REVOKE_REQUEST", agreementId: ordinaryTargetAgreement.id, reason: "Target is no longer eligible." }
    });
    assert.equal(privateTargetRevoke.status, 200, await privateTargetRevoke.clone().text());
    assert.deepEqual(await privateTargetRevoke.json(), { result: { id: ordinaryTargetAgreement.id, status: "REVOKED" } });

    await db.station.update({ where: { id: reclassifiedTarget.id }, data: { productFamily: "ONLINE" } });
    await db.channel.update({ where: { id: targetChannel.id }, data: { musicRightsUse: "CORRECTIONS_RADIO" } });
    const targetAfterTargetChannel = await workspace(targetCookie);
    assert.ok(!targetAfterTargetChannel.memberships.some(({ station }) => station.id === reclassifiedTarget.id));
    const privateTargetChannelRequest = await api("/api/radio-syndication", {
      method: "POST", cookie: targetCookie, body: requestInput
    });
    assert.equal(privateTargetChannelRequest.status, 409, await privateTargetChannelRequest.clone().text());
    assert.equal(await db.radioSyndicationAgreement.count({ where: {
      offerId: ordinaryCreatedOfferId, targetStationId: reclassifiedTarget.id
    } }), 0);
  } finally {
    try {
      if (userIds.length) await db.session.deleteMany({ where: { userId: { in: userIds } } });
      if (organisationIds.length) await db.auditLog.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.radioSyndicationAgreement.deleteMany({ where: { targetOrganisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.radioSyndicationOffer.deleteMany({ where: { sourceOrganisationId: { in: organisationIds } } });
      if (networkId) await db.stationNetworkAgreement.deleteMany({ where: { stationNetworkId: networkId } });
      if (networkId) await db.stationNetwork.delete({ where: { id: networkId } });
      if (organisationIds.length) await db.correctionsAnnouncement.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.schoolPodcastEpisode.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.schoolPodcastSeries.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId: { in: organisationIds } } } });
      if (organisationIds.length) await db.promoAsset.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.mediaAsset.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.channel.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.station.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.location.deleteMany({ where: { organisationId: { in: organisationIds } } });
      if (organisationIds.length) await db.organisation.deleteMany({ where: { id: { in: organisationIds } } });
      if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
