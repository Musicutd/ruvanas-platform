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
    const safeStation = await db.station.create({ data: {
      organisationId, productFamily: "RETAIL", name: "Fictional separate retail station", slug: `c9-safe-retail-${suffix}`,
      status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const safeChannel = await db.channel.create({ data: {
      organisationId, stationId: safeStation.id, name: "Fictional public retail channel",
      slug: `c9-safe-retail-channel-${suffix}`, status: "ACTIVE"
    } });
    await db.channelAssignment.createMany({ data: [
      { channelId: normalChannel.id, zoneId: normalLocation.zones[0].id },
      { channelId: normalChannel.id, zoneId: privateFacility.zones[0].id },
      { channelId: safeChannel.id, zoneId: sideZone.id }
    ] });

    const safePlaylistMode = await db.musicMode.create({ data: {
      organisationId, name: "Fictional public playlist", slug: `c9-public-playlist-${suffix}`, status: "ACTIVE"
    } });
    const privatePlaylistMode = await db.musicMode.create({ data: {
      organisationId, name: "Fictional private playlist sentinel", slug: `c9-private-playlist-${suffix}`, status: "ACTIVE"
    } });
    const activePrivatePlaylistMode = await db.musicMode.create({ data: {
      organisationId, name: "Fictional active Inside playlist sentinel", slug: `c9-active-inside-playlist-${suffix}`, status: "ACTIVE"
    } });
    const safeAdvancedMode = await db.musicMode.create({ data: {
      organisationId, name: "Fictional ordinary advanced playlist", slug: `c9-public-advanced-${suffix}`, status: "DRAFT"
    } });
    const privateAdvancedMode = await db.musicMode.create({ data: {
      organisationId, name: "Fictional private advanced sentinel", slug: `c9-private-advanced-${suffix}`, status: "DRAFT"
    } });
    const simplePlaylistData = { organisationId, createdByUserId: userId, status: "ACTIVE", rightsUse: "RETAIL_RADIO", simpleBuildMode: "RANDOM_GENRE_POOL", durationMinutes: 60, genreCodes: ["POP"] };
    const safePlaylist = await db.smartPlaylist.create({ data: { ...simplePlaylistData, musicModeId: safePlaylistMode.id } });
    const historicalPrivatePlaylist = await db.smartPlaylist.create({ data: { ...simplePlaylistData, musicModeId: privatePlaylistMode.id } });
    const activePrivatePlaylist = await db.smartPlaylist.create({ data: { ...simplePlaylistData, musicModeId: activePrivatePlaylistMode.id, rightsUse: "CORRECTIONS_RADIO" } });
    const safeAdvancedPlaylist = await db.smartPlaylist.create({ data: {
      organisationId, createdByUserId: userId, musicModeId: safeAdvancedMode.id,
      status: "DRAFT", rightsUse: "RETAIL_RADIO"
    } });
    const privateAdvancedPlaylist = await db.smartPlaylist.create({ data: {
      organisationId, createdByUserId: userId, musicModeId: privateAdvancedMode.id,
      status: "DRAFT", rightsUse: "CORRECTIONS_RADIO"
    } });
    await db.subscriberPlaylistEvent.create({ data: {
      organisationId, channelId: privateChannel.id, smartPlaylistId: historicalPrivatePlaylist.id,
      startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000),
      timezone: "Europe/Malta", createdByUserId: userId, cancelledAt: new Date()
    } });
    const privateEvent = await db.subscriberPlaylistEvent.create({ data: {
      organisationId, channelId: privateChannel.id, smartPlaylistId: activePrivatePlaylist.id,
      startsAt: new Date(Date.now() + 172_800_000), endsAt: new Date(Date.now() + 176_400_000),
      timezone: "Europe/Malta", createdByUserId: userId
    } });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const simpleView = await api("/api/programming/simple", { cookie });
    assert.equal(simpleView.status, 200, await simpleView.clone().text());
    const simple = await simpleView.json();
    assert.ok(simple.channels.some(({ id }) => id === safeChannel.id));
    assert.ok(!simple.channels.some(({ id }) => [normalChannel.id, privateChannel.id, privateRightsChannel.id].includes(id)));
    assert.ok(simple.playlists.some(({ id }) => id === safePlaylist.id));
    assert.ok(!simple.playlists.some(({ id }) => id === historicalPrivatePlaylist.id));
    assert.ok(!simple.playlists.some(({ id }) => id === activePrivatePlaylist.id));
    assert.ok(!simple.events.some(({ id }) => id === privateEvent.id));
    assert.doesNotMatch(JSON.stringify(simple), /Fictional private playlist sentinel|Fictional active Inside playlist sentinel|Inside channel|Legacy private rights channel/);
    const simplePayload = { name: "Fictional ordinary playlist", channelId: privateChannel.id, durationValue: 1, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"] };
    for (const channelId of [normalChannel.id, privateChannel.id, privateRightsChannel.id]) {
      const blocked = await api("/api/programming/simple", { method: "POST", cookie, body: { ...simplePayload, channelId } });
      assert.equal(blocked.status, 404, await blocked.clone().text());
      const nonstop = await api("/api/programming/simple/nonstop", { method: "PUT", cookie, body: { channelId, enabled: false } });
      assert.equal(nonstop.status, 404, await nonstop.clone().text());
      const genericAutoDj = await api("/api/programming/autodj", { method: "PUT", cookie, body: { channelId, enabled: false, playbackPolicy: "RUN_24_7" } });
      assert.equal(genericAutoDj.status, 404, await genericAutoDj.clone().text());
    }
    assert.equal(await db.autoDjPolicy.count({ where: { organisationId } }), 0);
    const historicalPrivatePolicy = await db.autoDjPolicy.create({ data: {
      organisationId, channelId: safeChannel.id, rightsUse: "CORRECTIONS_RADIO",
      targetType: "ZONE", targetId: privateFacility.zones[0].id, enabled: true, state: "ACTIVE"
    } });
    for (const path of ["/api/programming/simple/nonstop", "/api/programming/autodj"]) {
      const blocked = await api(path, { method: "PUT", cookie, body: {
        channelId: safeChannel.id, enabled: false,
        ...(path.endsWith("/autodj") ? { playbackPolicy: "RUN_24_7" } : {})
      } });
      assert.equal(blocked.status, 409, await blocked.clone().text());
    }
    const unchangedPrivatePolicy = await db.autoDjPolicy.findUnique({ where: { id: historicalPrivatePolicy.id } });
    assert.equal(unchangedPrivatePolicy.rightsUse, "CORRECTIONS_RADIO");
    assert.equal(unchangedPrivatePolicy.targetId, privateFacility.zones[0].id);
    assert.equal(unchangedPrivatePolicy.enabled, true);
    await db.autoDjPolicy.delete({ where: { id: historicalPrivatePolicy.id } });
    const expansionView = await api("/api/programming/autodj-expansion", { cookie });
    assert.equal(expansionView.status, 200, await expansionView.clone().text());
    const expansion = await expansionView.json();
    assert.ok(expansion.targets.some(({ channelId }) => channelId === safeChannel.id));
    assert.ok(!expansion.targets.some(({ channelId }) => [normalChannel.id, privateChannel.id, privateRightsChannel.id].includes(channelId)));
    assert.doesNotMatch(JSON.stringify(expansion), /Inside channel|Legacy private rights channel|Fictional private facility/);
    for (const [method, path, body] of [
      ["POST", `/api/programming/simple/${historicalPrivatePlaylist.id}`, { action: "duplicate" }],
      ["PATCH", `/api/programming/simple/${historicalPrivatePlaylist.id}`, simplePayload],
      ["DELETE", `/api/programming/simple/${historicalPrivatePlaylist.id}`],
      ["POST", `/api/programming/simple/${activePrivatePlaylist.id}`, { action: "duplicate" }],
      ["DELETE", `/api/programming/simple/events/${privateEvent.id}`]
    ]) {
      const blocked = await api(path, { method, cookie, body });
      assert.equal(blocked.status, 404, await blocked.clone().text());
    }
    const eventPayload = {
      channelId: privateChannel.id, playlistId: safePlaylist.id, timezone: "Europe/Malta",
      startsAt: "2030-01-01T09:00", endsAt: "2030-01-01T10:00"
    };
    const privateEventCreate = await api("/api/programming/simple/events", { method: "POST", cookie, body: eventPayload });
    assert.equal(privateEventCreate.status, 404, await privateEventCreate.clone().text());
    const privateEventUpdate = await api(`/api/programming/simple/events/${privateEvent.id}`, {
      method: "PATCH", cookie, body: { ...eventPayload, channelId: safeChannel.id }
    });
    assert.equal(privateEventUpdate.status, 404, await privateEventUpdate.clone().text());
    assert.equal(await db.subscriberPlaylistEvent.count({ where: { id: privateEvent.id, cancelledAt: null } }), 1);
    assert.ok((await db.smartPlaylist.findUnique({ where: { id: historicalPrivatePlaylist.id } })).status === "ACTIVE");
    const advancedView = await api("/api/programming/smart-playlists", { cookie });
    assert.equal(advancedView.status, 200, await advancedView.clone().text());
    const advanced = await advancedView.json();
    assert.ok(advanced.playlists.some(({ id }) => id === safeAdvancedPlaylist.id));
    assert.ok(!advanced.playlists.some(({ id }) => id === privateAdvancedPlaylist.id));
    assert.doesNotMatch(JSON.stringify(advanced), /Fictional private advanced sentinel/);
    const privateAdvancedPreview = await api(`/api/programming/smart-playlists/${privateAdvancedPlaylist.id}/preview`, { cookie });
    assert.equal(privateAdvancedPreview.status, 404, await privateAdvancedPreview.clone().text());
    const privateAdvancedArchive = await api(`/api/programming/smart-playlists/${privateAdvancedPlaylist.id}/archive`, { method: "POST", cookie });
    assert.equal(privateAdvancedArchive.status, 404, await privateAdvancedArchive.clone().text());
    assert.equal((await db.smartPlaylist.findUnique({ where: { id: privateAdvancedPlaylist.id } })).status, "DRAFT");

    const retailView = await api("/api/programming", { cookie });
    assert.equal(retailView.status, 200, await retailView.clone().text());
    const retail = await retailView.json();
    assert.ok(retail.targets.some(({ id }) => id === normalLocation.id));
    assert.ok(retail.targets.some(({ id }) => id === normalLocation.zones[0].id));
    assert.ok(!retail.targets.some(({ id }) => id === privateFacility.id || id === privateFacility.zones[0].id));
    assert.ok(retail.schedules.some(({ id }) => id === normalSchedule.id));
    assert.ok(!retail.schedules.some(({ id }) => id === privateSchedule.id));
    assert.ok(!retail.channels.some(({ id }) => id === normalChannel.id), "a channel shared with a private facility is unavailable in general programming");
    assert.ok(!retail.channels.some(({ id }) => id === privateChannel.id));
    assert.ok(!retail.channels.some(({ id }) => id === privateRightsChannel.id));
    assert.ok(retail.targets.every(({ channelIds }) => !channelIds.includes(normalChannel.id) && !channelIds.includes(privateChannel.id) && !channelIds.includes(privateRightsChannel.id)));

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
      ["LOCATION", privateFacility.id], ["ZONE", privateFacility.zones[0].id],
      ["STATION", normalStation.id], ["CHANNEL", normalChannel.id], ["CHANNEL", privateChannel.id]
    ]) {
      const blocked = await api("/api/promotions", { method: "POST", cookie, body: promotionPayload(targetType, targetId) });
      assert.equal(blocked.status, 400, await blocked.clone().text());
    }
    for (const [targetType, targetId, expectedZoneIds] of [
      ["LOCATION", normalLocation.id, [normalLocation.zones[0].id, sideZone.id]],
      ["ALL_LOCATIONS", null, [normalLocation.zones[0].id, sideZone.id]],
      ["LOCATION_GROUP", mixedGroup.id, [normalLocation.zones[0].id, sideZone.id]],
      ["STATION", safeStation.id, [sideZone.id]],
      ["CHANNEL", safeChannel.id, [sideZone.id]]
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
    const historicalStationCampaign = await db.campaign.create({ data: {
      ...campaignBase, name: "Fictional historically private station campaign", status: "DRAFT",
      targets: { create: { targetType: "STATION", stationId: normalStation.id } }
    } });
    const historicalChannelCampaign = await db.campaign.create({ data: {
      ...campaignBase, name: "Fictional historically private channel campaign", status: "DRAFT",
      targets: { create: { targetType: "CHANNEL", channelId: normalChannel.id } }
    } });
    const safeStationCampaign = await db.campaign.create({ data: {
      ...campaignBase, name: "Fictional safe station campaign", status: "DRAFT",
      targets: { create: { targetType: "STATION", stationId: safeStation.id } }
    } });
    const safeChannelCampaign = await db.campaign.create({ data: {
      ...campaignBase, name: "Fictional safe channel campaign", status: "DRAFT",
      targets: { create: { targetType: "CHANNEL", channelId: safeChannel.id } }
    } });
    const historicalList = await api("/api/promotions", { cookie });
    assert.equal(historicalList.status, 200, await historicalList.clone().text());
    const listedCampaigns = (await historicalList.json()).campaigns;
    assert.ok(!listedCampaigns.some(({ id }) => id === privateCampaign.id));
    assert.ok(!listedCampaigns.some(({ id }) => id === historicalStationCampaign.id || id === historicalChannelCampaign.id));
    assert.ok(listedCampaigns.some(({ id }) => id === safeStationCampaign.id));
    assert.ok(listedCampaigns.some(({ id }) => id === safeChannelCampaign.id));
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
    const normalIntent = await db.playoutIntent.create({ data: {
      ...intentBase, scheduleItemId: randomUUID(), playerId: normalPlayer.id,
      zoneId: normalLocation.zones[0].id, campaignId: normalCampaign.id,
      locationId: normalLocation.id, locationName: normalLocation.name
    } });
    const privateIntent = await db.playoutIntent.create({ data: {
      ...intentBase, scheduleItemId: randomUUID(), playerId: privatePlayer.id,
      zoneId: privateFacility.zones[0].id, campaignId: privateCampaign.id,
      locationId: privateFacility.id, locationName: privateFacility.name
    } });
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
    assert.ok(!reportBody.dimensions.campaigns.some(({ id }) =>
      id === historicalStationCampaign.id || id === historicalChannelCampaign.id));
    assert.ok(reportBody.dimensions.campaigns.some(({ id }) => id === safeStationCampaign.id));
    assert.ok(reportBody.dimensions.campaigns.some(({ id }) => id === safeChannelCampaign.id));
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
    const currentExport = await db.reportExportJob.findUnique({ where: { id: exportUrl.split("/").at(-1) } });
    assert.equal(currentExport.filters.visibilityScope, "GENERAL_NON_CORRECTIONS_CAMPAIGN_PROOF_V1");
    const csvResponse = await api(exportStatus.downloadUrl, { cookie });
    assert.equal(csvResponse.status, 200, await csvResponse.clone().text());
    const csv = await csvResponse.text();
    assert.match(csv, /Fictional normal shop/);
    assert.doesNotMatch(csv, /Fictional private facility/);
    const unmarkedLegacyExport = await db.reportExportJob.create({ data: {
      organisationId, requestedByUserId: userId, status: "READY", filters: reportDates,
      csvContent: "Fictional private facility", completedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000)
    } });
    const legacyExportUrl = `/api/reports/campaign-proof/exports/${unmarkedLegacyExport.id}`;
    assert.equal((await api(legacyExportUrl, { cookie })).status, 404);
    assert.equal((await api(`${legacyExportUrl}/download`, { cookie })).status, 404);

    const proofBase = {
      organisationId, itemType: "PROMO", promoVersionId: promoVersion.id, mediaAssetId: media.id,
      manifestVersion: randomUUID().replaceAll("-", "").slice(0, 24), eventType: "COMPLETED", occurredAt: new Date(),
      trackTitle: "Fictional promotion", trackArtist: "Fictional artist"
    };
    await db.proofOfPlayEvent.createMany({ data: [
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: normalIntent.scheduleItemId,
        playoutIntentId: normalIntent.id,
        playerId: normalPlayer.id, zoneId: normalLocation.zones[0].id, campaignId: normalCampaign.id,
        playerName: normalPlayer.name, locationName: normalLocation.name, zoneName: normalLocation.zones[0].name },
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: privateIntent.scheduleItemId,
        playoutIntentId: privateIntent.id,
        playerId: privatePlayer.id, zoneId: privateFacility.zones[0].id, campaignId: privateCampaign.id,
        playerName: privatePlayer.name, locationName: privateFacility.name, zoneName: privateFacility.zones[0].name },
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: normalIntent.scheduleItemId,
        playoutIntentId: normalIntent.id,
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
      manifestVersion: randomUUID().replaceAll("-", "").slice(0, 24), eventType: "COMPLETED", occurredAt: new Date()
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

    // The combined report covers ordinary proof rows; the malformed campaign-proof
    // fixtures below exercise a different, stricter intent-matching contract.
    const unconfirmedIntent = await db.playoutIntent.create({ data: {
      ...intentBase, scheduleItemId: randomUUID(), playerId: normalPlayer.id,
      zoneId: normalLocation.zones[0].id, campaignId: normalCampaign.id,
      locationId: normalLocation.id, locationName: normalLocation.name,
      plannedStart: new Date(intentBase.plannedStart.getTime() + 1_000)
    } });
    await db.playoutIntent.create({ data: {
      ...intentBase, scheduleItemId: randomUUID(), playerId: normalPlayer.id,
      zoneId: normalLocation.zones[0].id, channelId: normalChannel.id, campaignId: normalCampaign.id,
      locationId: normalLocation.id, locationName: normalLocation.name,
      plannedStart: new Date(intentBase.plannedStart.getTime() + 2_000)
    } });
    await db.proofOfPlayEvent.createMany({ data: [
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: unconfirmedIntent.scheduleItemId,
        playoutIntentId: unconfirmedIntent.id, playerId: normalPlayer.id, zoneId: normalLocation.zones[0].id,
        campaignId: normalCampaign.id, programmingSource: "CORRECTIONS_PROGRAMME",
        playerName: normalPlayer.name, locationName: normalLocation.name, zoneName: normalLocation.zones[0].name },
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: unconfirmedIntent.scheduleItemId,
        playoutIntentId: unconfirmedIntent.id, playerId: privatePlayer.id, zoneId: privateFacility.zones[0].id,
        campaignId: normalCampaign.id, playerName: privatePlayer.name,
        locationName: privateFacility.name, zoneName: privateFacility.zones[0].name },
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: unconfirmedIntent.scheduleItemId,
        playoutIntentId: unconfirmedIntent.id, playerId: privatePlayer.id, zoneId: normalLocation.zones[0].id,
        campaignId: normalCampaign.id, playerName: privatePlayer.name,
        locationName: normalLocation.name, zoneName: normalLocation.zones[0].name },
      { ...proofBase, clientEventId: randomUUID(), scheduleItemId: randomUUID(),
        playoutIntentId: unconfirmedIntent.id, playerId: normalPlayer.id, zoneId: normalLocation.zones[0].id,
        campaignId: normalCampaign.id, playerName: normalPlayer.name,
        locationName: normalLocation.name, zoneName: normalLocation.zones[0].name }
    ] });
    const verifiedReport = await api(`/api/reports/campaign-proof?${reportQuery}`, { cookie });
    assert.equal(verifiedReport.status, 200, await verifiedReport.clone().text());
    const verifiedSummary = (await verifiedReport.json()).report.summary;
    assert.equal(verifiedSummary.planned, 2,
      "a historically private-assigned channel cannot contribute a general campaign intent");
    assert.equal(verifiedSummary.completed, 1,
      "private-source, private-facility, wrong-player, or wrong-item proof cannot confirm an ordinary campaign intent");

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
