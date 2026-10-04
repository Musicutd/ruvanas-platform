import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { generalRadioSyndicationDeliveryAllowed } from "../../lib/radio-syndication-general-boundary.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

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
          kind: "RECORDED_PROGRAMME", sourceOrganisationId: source.id,
          sourceStationId: sourceStation.id, sourceChannelId: null,
          sourcePodcastEpisode: { organisationId: source.id, mediaAsset: { id: asset.id } }
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
        sourcePodcastEpisode: null
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
