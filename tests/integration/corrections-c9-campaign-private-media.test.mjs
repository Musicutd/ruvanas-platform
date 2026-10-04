import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { createPlayerToken, hashPlayerToken } from "../../lib/player-tokens.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { headers, redirect: "manual" });
}

function insertionFor(manifest, mediaAssetId) {
  return manifest.insertions.find(({ mediaUrl }) => mediaUrl?.includes(`/media/${mediaAssetId}?`));
}

test("ordinary campaign media withdraws from both players and stale URLs when it becomes Inside-private", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 campaign media integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 campaign plan ${suffix}`, code: `C9_CAMPAIGN_${suffix}`,
      productFamily: "RETAIL", tierNumber: 1, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      retailRadioEnabled: true, stationLimit: 1
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 campaign ${suffix}`, slug: `c9-campaign-${suffix}`
    } });
    organisationId = organisation.id;
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const user = await db.user.create({ data: {
      email: `c9-campaign-${suffix}@example.invalid`,
      passwordHash: await bcrypt.hash(`CI-only-${suffix}!`, 4), role: "OWNER"
    } });
    userId = user.id;
    const shop = await db.location.create({ data: {
      organisationId, name: "Fictional shop", slug: `c9-shop-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "Shop floor", slug: "shop-floor", status: "ACTIVE" } }
    }, include: { zones: true } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-facility-${suffix}`, status: "ACTIVE",
      correctionsFacility: { create: {} }
    } });
    const station = await db.station.create({ data: {
      organisationId, productFamily: "RETAIL", name: "Fictional retail station",
      slug: `c9-station-${suffix}`, status: "ACTIVE", publicPlayerEnabled: true,
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const channel = await db.channel.create({ data: {
      organisationId, stationId: station.id, name: "Shop channel",
      slug: `c9-channel-${suffix}`, status: "ACTIVE"
    } });
    await db.channelAssignment.create({ data: { channelId: channel.id, zoneId: shop.zones[0].id } });
    const playerToken = createPlayerToken();
    const player = await db.player.create({ data: {
      organisationId, zoneId: shop.zones[0].id, name: "Fictional shop player",
      status: "ONLINE", sessionTokenHash: hashPlayerToken(playerToken, process.env.SESSION_SECRET),
      enrolledAt: new Date(), lastHeartbeatAt: new Date()
    } });

    async function campaign(name) {
      const media = await db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name,
        originalName: "fictional.mp3", storageKey: `c9-campaign/${randomUUID()}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: BigInt(1024), durationSeconds: 20,
        mediaType: "COMMERCIAL", status: "READY"
      } });
      const promo = await db.promoAsset.create({ data: {
        organisationId, name, mediaType: "COMMERCIAL"
      } });
      const version = await db.promoVersion.create({ data: {
        promoAssetId: promo.id, mediaAssetId: media.id, version: 1,
        status: "APPROVED", qcStatus: "PASSED", durationSeconds: 20
      } });
      await db.campaign.create({ data: {
        organisationId, promoVersionId: version.id, name, status: "PUBLISHED",
        schedulingMode: "INTERVAL", publicationRevision: 1,
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2030-01-01T00:00:00.000Z"),
        respectOpeningHours: false,
        targets: { create: { targetType: "LOCATION", locationId: shop.id } },
        rule: { create: { intervalMinutes: 5 } },
        schedules: { create: Array.from({ length: 7 }, (_, weekday) => ({
          weekday, windowMode: "INTERVAL", startMinute: 0, endMinute: 1440, intervalMinutes: 5
        })) }
      } });
      return { media, version };
    }

    const formerlyOrdinary = await campaign("Fictional promotion later submitted to Inside");
    const playerHeaders = {
      cookie: `ruvanas_player=${playerToken}`,
      "x-ruvanas-player-instance": randomUUID()
    };
    const publicHeaders = { "x-ruvanas-listener-session": randomUUID() };
    const playerPath = "/api/player/manifest";
    const publicPath = `/api/public/player/${station.slug}/manifest`;
    async function manifest(path, headers) {
      const response = await api(path, headers);
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    }

    const playerBefore = await manifest(playerPath, playerHeaders);
    const publicBefore = await manifest(publicPath, publicHeaders);
    const playerInsertion = insertionFor(playerBefore, formerlyOrdinary.media.id);
    const publicInsertion = insertionFor(publicBefore, formerlyOrdinary.media.id);
    assert.ok(playerInsertion, "ordinary campaign should appear in enrolled player manifest");
    assert.ok(publicInsertion, "ordinary campaign should appear in public retail manifest");
    assert.ok(await db.playoutIntent.count({ where: {
      organisationId, playerId: player.id, mediaAssetId: formerlyOrdinary.media.id
    } }), "the old player intent should remain to exercise stale-URL protection");

    // A historical ordinary campaign must stop serving this exact asset once
    // Corrections Guard references it; campaign publication is not authority.
    await db.correctionsAnnouncement.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional private evidence",
      mediaAssetId: formerlyOrdinary.media.id, promoVersionId: formerlyOrdinary.version.id,
      createdByUserId: userId
    } });
    const playerAfter = await manifest(playerPath, playerHeaders);
    const publicAfter = await manifest(publicPath, publicHeaders);
    assert.equal(insertionFor(playerAfter, formerlyOrdinary.media.id), undefined);
    assert.equal(insertionFor(publicAfter, formerlyOrdinary.media.id), undefined);
    assert.equal((await api(playerInsertion.mediaUrl, playerHeaders)).status, 404,
      "a prior player listener URL and persisted intent must not reopen private audio");
    assert.equal((await api(publicInsertion.mediaUrl)).status, 404,
      "a prior public listener URL must not reopen private audio");

    const ordinaryControl = await campaign("Fictional still-public promotion");
    assert.ok(insertionFor(await manifest(playerPath, playerHeaders), ordinaryControl.media.id),
      "normal retail campaign playback must remain available");
    assert.ok(insertionFor(await manifest(publicPath, publicHeaders), ordinaryControl.media.id),
      "normal public retail campaign playback must remain available");
  } finally {
    try {
      if (organisationId) await db.correctionsAnnouncement.deleteMany({ where: { organisationId } });
      if (organisationId) await db.playoutIntent.deleteMany({ where: { organisationId } });
      if (organisationId) await db.campaign.deleteMany({ where: { organisationId } });
      if (organisationId) await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId } } });
      if (organisationId) await db.promoAsset.deleteMany({ where: { organisationId } });
      if (organisationId) await db.mediaAsset.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisation.delete({ where: { id: organisationId } });
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
