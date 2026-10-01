import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", cookie, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  return response;
}

test("general programming cannot expose or draft schedules for private Inside facilities", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 general-programming integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  const planIds = [];
  try {
    const retailPlan = await db.plan.create({ data: {
      name: `Fictional C9 retail ${suffix}`, code: `C9_RETAIL_${suffix}`, productFamily: "RETAIL", tierNumber: 1,
      monthlyPriceCents: 0, storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      retailRadioEnabled: true, stationLimit: 1
    } });
    planIds.push(retailPlan.id);
    const insidePlan = await db.plan.create({ data: {
      name: `Fictional C9 Inside ${suffix}`, code: `C9_INSIDE_${suffix}`, productFamily: "CORRECTIONS", tierNumber: 2,
      monthlyPriceCents: 0, storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      correctionsRadioEnabled: true, stationLimit: 1
    } });
    planIds.push(insidePlan.id);
    const organisation = await db.organisation.create({
      data: { name: `Fictional C9 programming ${suffix}`, slug: `c9-programming-${suffix}` }
    });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-programming-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId: retailPlan.id, status: "ACTIVE" } });

    const normalLocation = await db.location.create({ data: {
      organisationId, name: "Fictional normal shop", slug: `c9-shop-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "Shop floor", slug: "shop-floor", status: "ACTIVE" } }
    }, include: { zones: true } });
    const sideZone = await db.zone.create({ data: {
      locationId: normalLocation.id, name: "Shop side room", slug: "shop-side-room", status: "ACTIVE"
    } });
    const privateFacility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-inside-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "Private wing", slug: "private-wing", status: "ACTIVE" } },
      correctionsFacility: { create: {} }
    }, include: { zones: true } });
    const mixedGroup = await db.locationGroup.create({ data: {
      organisationId, name: "Fictional mixed group", slug: `c9-mixed-${suffix}`,
      locations: { create: [{ locationId: normalLocation.id }, { locationId: privateFacility.id }] }
    } });
    const privateGroup = await db.locationGroup.create({ data: {
      organisationId, name: "Fictional private group", slug: `c9-private-${suffix}`,
      locations: { create: { locationId: privateFacility.id } }
    } });
    const mode = await db.musicMode.create({ data: {
      organisationId, name: "Fictional approved mode", slug: `c9-mode-${suffix}`, status: "ACTIVE"
    } });
    const media = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional generic promotion",
      originalName: "promotion.mp3", storageKey: `c9-integration/${suffix}.mp3`, mimeType: "audio/mpeg",
      sizeBytes: BigInt(1024), durationSeconds: 20, mediaType: "COMMERCIAL", status: "READY"
    } });
    const promo = await db.promoAsset.create({ data: { organisationId, name: "Fictional generic promotion", mediaType: "COMMERCIAL" } });
    const promoVersion = await db.promoVersion.create({ data: {
      promoAssetId: promo.id, mediaAssetId: media.id, version: 1, status: "APPROVED", qcStatus: "PASSED", durationSeconds: 20
    } });
    const normalSchedule = await db.musicSchedule.create({ data: {
      organisationId, locationId: normalLocation.id, name: "Normal draft", timezone: "Europe/Malta",
      slots: { create: { weekday: 1, startMinute: 540, endMinute: 600, musicModeId: mode.id } }
    } });
    const privateSchedule = await db.musicSchedule.create({ data: {
      organisationId, locationId: privateFacility.id, name: "Private historical draft", timezone: "Europe/Malta",
      slots: { create: { weekday: 1, startMinute: 540, endMinute: 600, musicModeId: mode.id } }
    } });
    const normalStation = await db.station.create({ data: {
      organisationId, productFamily: "RETAIL", name: "Fictional retail station", slug: `c9-retail-station-${suffix}`,
      status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const privateStation = await db.station.create({ data: {
      organisationId, productFamily: "CORRECTIONS", name: "Fictional Inside station", slug: `c9-inside-station-${suffix}`,
      status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const normalChannel = await db.channel.create({ data: {
      organisationId, stationId: normalStation.id, name: "Retail channel", slug: `c9-retail-channel-${suffix}`, status: "ACTIVE"
    } });
    const privateChannel = await db.channel.create({ data: {
      organisationId, stationId: privateStation.id, name: "Inside channel", slug: `c9-inside-channel-${suffix}`,
      status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO"
    } });
    const privateRightsChannel = await db.channel.create({ data: {
      organisationId, name: "Legacy private rights channel", slug: `c9-private-rights-${suffix}`,
      status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO"
    } });
    await db.channelAssignment.create({ data: {
      channelId: privateChannel.id, zoneId: sideZone.id
    } });
    await db.channelAssignment.createMany({ data: [
      { channelId: normalChannel.id, zoneId: normalLocation.zones[0].id },
      { channelId: normalChannel.id, zoneId: privateFacility.zones[0].id }
    ] });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const retailView = await api("/api/programming", { cookie });
    assert.equal(retailView.status, 200, await retailView.clone().text());
    const retail = await retailView.json();
    assert.ok(retail.targets.some(({ id }) => id === normalLocation.id));
    assert.ok(retail.targets.some(({ id }) => id === normalLocation.zones[0].id));
    assert.ok(!retail.targets.some(({ id }) => id === privateFacility.id || id === privateFacility.zones[0].id));
    assert.ok(retail.schedules.some(({ id }) => id === normalSchedule.id));
    assert.ok(!retail.schedules.some(({ id }) => id === privateSchedule.id));
    assert.ok(retail.channels.some(({ id }) => id === normalChannel.id));
    assert.ok(!retail.channels.some(({ id }) => id === privateChannel.id));
    assert.ok(!retail.channels.some(({ id }) => id === privateRightsChannel.id));
    assert.ok(retail.targets.every(({ channelIds }) => !channelIds.includes(privateChannel.id) && !channelIds.includes(privateRightsChannel.id)));

    const payload = (targetType, targetId) => ({
      targetType, targetId, name: "Fictional draft", publish: false,
      slots: [{ weekday: 2, startsAt: "09:00", endsAt: "10:00", musicModeId: mode.id }]
    });
    for (const [targetType, targetId] of [["LOCATION", privateFacility.id], ["ZONE", privateFacility.zones[0].id]]) {
      const blocked = await api("/api/programming", { method: "POST", cookie, body: payload(targetType, targetId) });
      assert.equal(blocked.status, 404, await blocked.clone().text());
    }
    assert.equal(await db.musicSchedule.count({ where: { organisationId, locationId: privateFacility.id } }), 1);
    assert.equal(await db.musicSchedule.count({ where: { organisationId, zoneId: privateFacility.zones[0].id } }), 0);
    const normalDraft = await api("/api/programming", { method: "POST", cookie, body: payload("LOCATION", normalLocation.id) });
    assert.equal(normalDraft.status, 201, await normalDraft.clone().text());

    const promotions = await api("/api/promotions", { cookie });
    assert.equal(promotions.status, 200, await promotions.clone().text());
    const promotionData = await promotions.json();
    assert.ok(promotionData.targets.some(({ id }) => id === normalLocation.id));
    assert.ok(promotionData.targets.some(({ id }) => id === normalLocation.zones[0].id));
    assert.ok(promotionData.targets.some(({ id }) => id === sideZone.id));
    assert.ok(!promotionData.targets.some(({ id }) => id === privateFacility.id || id === privateFacility.zones[0].id));

    const promotionStart = new Date();
    const promotionEnd = new Date(promotionStart.getTime() + 6 * 86_400_000);
    const promotionPayload = (targetType, targetId) => ({
      promoVersionId: promoVersion.id, name: "Fictional public promotion", schedulingMode: "PLAYS_PER_HOUR",
      playsPerHour: 1, effectiveFrom: promotionStart.toISOString().slice(0, 10), effectiveTo: promotionEnd.toISOString().slice(0, 10),
      respectOpeningHours: false, previewOnly: true,
      targets: [{ targetType, targetId }],
      schedules: [{ weekday: 1, startsAt: "09:00", endsAt: "10:00" }]
    });
    for (const [targetType, targetId] of [
      ["LOCATION", privateFacility.id], ["ZONE", privateFacility.zones[0].id], ["CHANNEL", privateChannel.id]
    ]) {
      const blocked = await api("/api/promotions", { method: "POST", cookie, body: promotionPayload(targetType, targetId) });
      assert.equal(blocked.status, 400, await blocked.clone().text());
    }
    for (const [targetType, targetId, expectedZoneIds] of [
      ["LOCATION", normalLocation.id, [normalLocation.zones[0].id, sideZone.id]],
      ["ALL_LOCATIONS", null, [normalLocation.zones[0].id, sideZone.id]],
      ["LOCATION_GROUP", mixedGroup.id, [normalLocation.zones[0].id, sideZone.id]],
      ["CHANNEL", normalChannel.id, [normalLocation.zones[0].id]]
    ]) {
      const preview = await api("/api/promotions", { method: "POST", cookie, body: promotionPayload(targetType, targetId) });
      assert.equal(preview.status, 200, await preview.clone().text());
      const prepared = await preview.json();
      assert.deepEqual(prepared.targetZones.map(({ id }) => id), expectedZoneIds.sort());
    }
    assert.equal(await db.campaign.count({ where: { organisationId } }), 0);

    const campaignBase = {
      organisationId, promoVersionId: promoVersion.id, schedulingMode: "PLAYS_PER_HOUR",
      effectiveFrom: promotionStart, effectiveTo: promotionEnd,
      rule: { create: { playsPerHour: 1 } },
      schedules: { create: { weekday: 1, windowMode: "PLAYS_PER_HOUR", startMinute: 540, endMinute: 600, playsPerHour: 1 } }
    };
    const privateCampaign = await db.campaign.create({ data: {
      ...campaignBase, name: "Fictional historical private campaign", status: "PUBLISHED",
      targets: { create: { targetType: "LOCATION", locationId: privateFacility.id } }
    } });
    const mixedCampaign = await db.campaign.create({ data: {
      ...campaignBase, name: "Fictional mixed-target draft", status: "DRAFT",
      targets: { create: [
        { targetType: "LOCATION", locationId: normalLocation.id },
        { targetType: "LOCATION", locationId: privateFacility.id }
      ] }
    } });
    const normalCampaign = await db.campaign.create({ data: {
      ...campaignBase, name: "Fictional normal campaign", status: "PUBLISHED",
      targets: { create: { targetType: "LOCATION", locationId: normalLocation.id } }
    } });
    const historicalList = await api("/api/promotions", { cookie });
    assert.equal(historicalList.status, 200, await historicalList.clone().text());
    const listedCampaigns = (await historicalList.json()).campaigns;
    assert.ok(!listedCampaigns.some(({ id }) => id === privateCampaign.id));
    assert.deepEqual(listedCampaigns.find(({ id }) => id === mixedCampaign.id)?.targets.map(({ label }) => label), [normalLocation.name]);
    const historicalPreview = await api("/api/promotions", { method: "POST", cookie, body: promotionPayload("LOCATION", normalLocation.id) });
    assert.equal(historicalPreview.status, 200, await historicalPreview.clone().text());

    const normalPlayer = await db.player.create({ data: {
      organisationId, zoneId: normalLocation.zones[0].id, name: "Fictional shop player"
    } });
    const privatePlayer = await db.player.create({ data: {
      organisationId, zoneId: privateFacility.zones[0].id, name: "Fictional private player"
    } });
    const intentBase = {
      organisationId, promoVersionId: promoVersion.id, mediaAssetId: media.id,
      locationTimezone: "Europe/Malta", locationGroups: [], publicationRevision: 1,
      sourceRevision: `c9-fixture-${suffix}`, plannedStart: new Date(),
      expiresAt: new Date(Date.now() + 60_000)
    };
    await db.playoutIntent.createMany({ data: [
      { ...intentBase, scheduleItemId: randomUUID(), playerId: normalPlayer.id,
        zoneId: normalLocation.zones[0].id, campaignId: normalCampaign.id,
        locationId: normalLocation.id, locationName: normalLocation.name },
      { ...intentBase, scheduleItemId: randomUUID(), playerId: privatePlayer.id,
        zoneId: privateFacility.zones[0].id, campaignId: privateCampaign.id,
        locationId: privateFacility.id, locationName: privateFacility.name }
    ] });
    const reportDates = {
      from: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    };
    const reportQuery = new URLSearchParams(reportDates).toString();
    const report = await api(`/api/reports/campaign-proof?${reportQuery}`, { cookie });
    assert.equal(report.status, 200, await report.clone().text());
    const reportBody = await report.json();
    assert.equal(reportBody.report.summary.planned, 1);
    assert.equal(reportBody.report.rows[0].locationName, normalLocation.name);
    assert.ok(reportBody.dimensions.locations.some(({ id }) => id === normalLocation.id));
    assert.ok(!reportBody.dimensions.locations.some(({ id }) => id === privateFacility.id));
    assert.ok(reportBody.dimensions.locationGroups.some(({ id }) => id === mixedGroup.id));
    assert.ok(!reportBody.dimensions.locationGroups.some(({ id }) => id === privateGroup.id));
    assert.ok(reportBody.dimensions.campaigns.some(({ id }) => id === normalCampaign.id));
    assert.ok(reportBody.dimensions.campaigns.some(({ id }) => id === mixedCampaign.id));
    assert.ok(!reportBody.dimensions.campaigns.some(({ id }) => id === privateCampaign.id));
    const privateReport = await api(`/api/reports/campaign-proof?${reportQuery}&locationId=${privateFacility.id}`, { cookie });
    assert.equal(privateReport.status, 200, await privateReport.clone().text());
    assert.equal((await privateReport.json()).report.summary.planned, 0);

    const exportRequest = await api("/api/reports/campaign-proof/exports", { method: "POST", cookie, body: reportDates });
    assert.equal(exportRequest.status, 202, await exportRequest.clone().text());
    const exportUrl = (await exportRequest.json()).job.statusUrl;
    let exportStatus;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await api(exportUrl, { cookie });
      assert.equal(response.status, 200, await response.clone().text());
      exportStatus = (await response.json()).job;
      if (exportStatus.status === "READY") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(exportStatus.status, "READY", exportStatus.error || "Export did not complete");
    const csvResponse = await api(exportStatus.downloadUrl, { cookie });
    assert.equal(csvResponse.status, 200, await csvResponse.clone().text());
    const csv = await csvResponse.text();
    assert.match(csv, /Fictional normal shop/);
    assert.doesNotMatch(csv, /Fictional private facility/);

    const proofBase = {
      organisationId, itemType: "PROMO", promoVersionId: promoVersion.id, mediaAssetId: media.id,
      manifestVersion: "c9-fixture", eventType: "COMPLETED", occurredAt: new Date(),
      trackTitle: "Fictional promotion", trackArtist: "Fictional artist"
    };
    await db.proofOfPlayEvent.createMany({ data: [
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: randomUUID(),
        playerId: normalPlayer.id, zoneId: normalLocation.zones[0].id, campaignId: normalCampaign.id,
        playerName: normalPlayer.name, locationName: normalLocation.name, zoneName: normalLocation.zones[0].name },
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: randomUUID(),
        playerId: privatePlayer.id, zoneId: privateFacility.zones[0].id, campaignId: privateCampaign.id,
        playerName: privatePlayer.name, locationName: privateFacility.name, zoneName: privateFacility.zones[0].name },
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: randomUUID(),
        playerId: normalPlayer.id, zoneId: normalLocation.zones[0].id, campaignId: normalCampaign.id,
        programmingSource: "CORRECTIONS_PROGRAMME", playerName: normalPlayer.name,
        locationName: "Fictional private snapshot", zoneName: normalLocation.zones[0].name }
    ] });
    const visualAsset = await db.digitalSignageAsset.create({ data: {
      organisationId, uploadedByUserId: userId, name: "Fictional visual advert",
      originalName: "advert.png", storageKey: `c9-integration/${suffix}.png`, mimeType: "image/png",
      sizeBytes: BigInt(1024), checksumSha256: randomUUID().replaceAll("-", "").repeat(2), width: 100, height: 100
    } });
    const visualLayout = await db.digitalSignageLayout.create({ data: {
      organisationId, createdByUserId: userId, name: `Fictional visual layout ${suffix}`,
      canvasWidth: 1920, canvasHeight: 1080
    } });
    const visualRegion = await db.digitalSignageLayoutRegion.create({ data: {
      layoutId: visualLayout.id, name: "Main", x: 0, y: 0, width: 1920, height: 1080
    } });
    const visualPlaylist = await db.digitalSignagePlaylist.create({ data: {
      organisationId, layoutId: visualLayout.id, createdByUserId: userId,
      name: `Fictional visual playlist ${suffix}`
    } });
    const visualItem = await db.digitalSignagePlaylistItem.create({ data: {
      playlistId: visualPlaylist.id, regionId: visualRegion.id, assetId: visualAsset.id, position: 1
    } });
    const publicDevice = await db.digitalSignageDevice.create({ data: {
      organisationId, zoneId: normalLocation.zones[0].id, createdByUserId: userId,
      name: "Fictional shop screen", viewportWidth: 1920, viewportHeight: 1080
    } });
    const privateDevice = await db.digitalSignageDevice.create({ data: {
      organisationId, zoneId: privateFacility.zones[0].id, createdByUserId: userId,
      name: "Fictional private screen", viewportWidth: 1920, viewportHeight: 1080
    } });
    await db.digitalSignageDeliveryProof.createMany({ data: [publicDevice, privateDevice].map((device) => ({
      clientEventId: randomUUID(), organisationId, deviceId: device.id,
      playlistId: visualPlaylist.id, playlistItemId: visualItem.id, assetId: visualAsset.id,
      manifestVersion: "c9-fixture", eventType: "COMPLETED", occurredAt: new Date()
    })) });
    const combined = await api(`/api/reports/combined-delivery?${reportQuery}`, { cookie });
    assert.equal(combined.status, 200, await combined.clone().text());
    const combinedReport = (await combined.json()).report;
    assert.equal(combinedReport.summary.audioCompleted, 1);
    assert.equal(combinedReport.summary.visualCompleted, 1);
    assert.equal(combinedReport.rows.length, 2);
    assert.ok(combinedReport.rows.every(({ location }) => location === normalLocation.name));
    const combinedCsv = await api(`/api/reports/combined-delivery/export?${reportQuery}`, { cookie });
    assert.equal(combinedCsv.status, 200, await combinedCsv.clone().text());
    const combinedText = await combinedCsv.text();
    assert.match(combinedText, /Fictional normal shop/);
    assert.doesNotMatch(combinedText, /Fictional private facility|Fictional private snapshot/);

    await db.subscription.update({ where: { organisationId }, data: { planId: insidePlan.id } });
    assert.equal((await api("/api/programming", { cookie })).status, 403);
    assert.equal((await api("/api/programming", { method: "POST", cookie, body: payload("LOCATION", normalLocation.id) })).status, 403);
    assert.equal((await api("/api/promotions", { cookie })).status, 403);
    assert.equal((await api("/api/promotions", { method: "POST", cookie, body: promotionPayload("LOCATION", normalLocation.id) })).status, 403);
    assert.equal((await api(`/api/promotions/${normalSchedule.id}`, { method: "PATCH", cookie, body: { action: "PUBLISH" } })).status, 403);
    assert.equal((await api("/api/reports/campaign-proof", { cookie })).status, 403);
    assert.equal((await api("/api/reports/campaign-proof/exports", { method: "POST", cookie, body: {} })).status, 403);
    assert.equal((await api(exportUrl, { cookie })).status, 403);
    assert.equal((await api(exportStatus.downloadUrl, { cookie })).status, 403);
    assert.equal((await api("/api/reports/combined-delivery", { cookie })).status, 403);
    assert.equal((await api("/api/reports/combined-delivery/export", { cookie })).status, 403);
  } finally {
    try {
      if (organisationId) await db.musicSchedule.deleteMany({ where: { organisationId } });
      if (organisationId) await db.digitalSignageDeliveryProof.deleteMany({ where: { organisationId } });
      if (organisationId) await db.digitalSignagePlaylistItem.deleteMany({ where: { playlist: { organisationId } } });
      if (organisationId) await db.digitalSignagePlaylist.deleteMany({ where: { organisationId } });
      if (organisationId) await db.digitalSignageLayoutRegion.deleteMany({ where: { layout: { organisationId } } });
      if (organisationId) await db.digitalSignageLayout.deleteMany({ where: { organisationId } });
      if (organisationId) await db.digitalSignageDevice.deleteMany({ where: { organisationId } });
      if (organisationId) await db.digitalSignageAsset.deleteMany({ where: { organisationId } });
      if (organisationId) await db.proofOfPlayEvent.deleteMany({ where: { organisationId } });
      if (organisationId) await db.playoutIntent.deleteMany({ where: { organisationId } });
      if (organisationId) await db.campaign.deleteMany({ where: { organisationId } });
      if (organisationId) await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId } } });
      if (organisationId) await db.promoAsset.deleteMany({ where: { organisationId } });
      if (organisationId) await db.mediaAsset.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisation.delete({ where: { id: organisationId } });
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    } finally {
      await db.$disconnect();
    }
  }
});
