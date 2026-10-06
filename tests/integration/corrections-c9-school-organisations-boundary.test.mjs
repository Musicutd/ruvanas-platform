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
    method,
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

test("School and Organisations cannot expose or target private Inside facilities", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 mixed-product integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  const planIds = [];
  let organisationId;
  let userId;
  try {
    const planData = (productFamily, tierNumber, feature) => ({
      name: `Fictional C9 ${productFamily} ${suffix}`, code: `C9_${productFamily}_${suffix}`,
      productFamily, tierNumber, monthlyPriceCents: 0, storageLimitGb: 1,
      listenerLimit: 10, maxBitrateKbps: 128, stationLimit: 1, [feature]: true
    });
    const schoolPlan = await db.plan.create({ data: planData("SCHOOL", 2, "schoolRadioEnabled") });
    const organisationsPlan = await db.plan.create({ data: planData("ORGANISATIONS", 4, "organisationsEnabled") });
    planIds.push(schoolPlan.id, organisationsPlan.id);
    const organisation = await db.organisation.create({
      data: { name: `Fictional mixed school ${suffix}`, slug: `c9-school-${suffix}` }
    });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-school-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    const member = await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId: schoolPlan.id, status: "ACTIVE" } });

    const publicLocation = await db.location.create({ data: {
      organisationId, name: "Fictional school campus", slug: `c9-school-campus-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "School hall", slug: "school-hall", status: "ACTIVE" } }
    }, include: { zones: true } });
    const privateFacility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-private-facility-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "Private wing", slug: "private-wing", status: "ACTIVE" } },
      correctionsFacility: { create: {} }
    }, include: { zones: true } });
    const media = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional school announcement",
      originalName: "school.mp3", storageKey: `c9-integration/${suffix}.mp3`, mimeType: "audio/mpeg",
      sizeBytes: BigInt(1024), durationSeconds: 20, mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    const promo = await db.promoAsset.create({ data: { organisationId, name: "Fictional school announcement", mediaType: "ANNOUNCEMENT" } });
    const version = await db.promoVersion.create({ data: {
      promoAssetId: promo.id, mediaAssetId: media.id, version: 1,
      status: "APPROVED", qcStatus: "PASSED", durationSeconds: 20
    } });
    const announcement = await db.schoolAnnouncement.create({ data: {
      organisationId, promoVersionId: version.id, title: "Fictional approved school notice",
      status: "APPROVED", createdByUserId: userId
    } });
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const publicSlot = await db.schoolBroadcastSlot.create({ data: {
      organisationId, announcementId: announcement.id, locationId: publicLocation.id,
      startsAt, endsAt, approvedByUserId: userId
    } });
    const privateSlot = await db.schoolBroadcastSlot.create({ data: {
      organisationId, announcementId: announcement.id, zoneId: privateFacility.zones[0].id,
      startsAt, endsAt, approvedByUserId: userId
    } });
    const publicPost = await db.schoolNoticeboardPost.create({ data: {
      organisationId, announcementId: announcement.id, zoneId: publicLocation.zones[0].id,
      startsAt, endsAt, createdByUserId: userId
    } });
    const privatePost = await db.schoolNoticeboardPost.create({ data: {
      organisationId, announcementId: announcement.id, locationId: privateFacility.id,
      startsAt, endsAt, createdByUserId: userId
    } });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    for (const path of ["/api/school-radio/announcements", "/api/school-radio/show-builder"]) {
      const response = await api(path, { cookie });
      assert.equal(response.status, 200, await response.clone().text());
      const payload = await response.json();
      assert.ok(payload.locations.some(({ id }) => id === publicLocation.id));
      assert.ok(!payload.locations.some(({ id }) => id === privateFacility.id));
      if (path.endsWith("announcements")) {
        const listed = payload.announcements.find(({ id }) => id === announcement.id);
        assert.deepEqual(listed.broadcastSlots.map(({ id }) => id), [publicSlot.id]);
      }
    }
    const noticeboard = await api("/api/school-radio/noticeboard", { cookie });
    assert.equal(noticeboard.status, 200, await noticeboard.clone().text());
    assert.deepEqual((await noticeboard.json()).posts.map(({ id }) => id), [publicPost.id]);

    const laterStart = new Date(endsAt.getTime() + 60 * 60 * 1000);
    const laterEnd = new Date(laterStart.getTime() + 30 * 60 * 1000);
    const slotBody = (targetType, targetId) => ({
      announcementId: announcement.id, [targetType]: targetId,
      startsAt: laterStart.toISOString(), endsAt: laterEnd.toISOString()
    });
    const postBody = (targetType, targetId) => ({
      announcementId: announcement.id, [targetType]: targetId,
      startsAt: laterStart.toISOString(), endsAt: laterEnd.toISOString()
    });
    for (const [targetType, targetId] of [["locationId", privateFacility.id], ["zoneId", privateFacility.zones[0].id]]) {
      const slot = await api("/api/school-radio/broadcast-slots", { method: "POST", cookie, body: slotBody(targetType, targetId) });
      assert.equal(slot.status, 400, await slot.clone().text());
      const post = await api("/api/school-radio/noticeboard", { method: "POST", cookie, body: postBody(targetType, targetId) });
      assert.equal(post.status, 400, await post.clone().text());
    }
    for (const [path, recordId] of [["broadcast-slots", privateSlot.id], ["noticeboard", privatePost.id]]) {
      const response = await api(`/api/school-radio/${path}/${recordId}`, { method: "PATCH", cookie, body: { reason: "Fictional test cancellation" } });
      assert.equal(response.status, 404, await response.clone().text());
    }
    const normalSlot = await api("/api/school-radio/broadcast-slots", { method: "POST", cookie, body: slotBody("zoneId", publicLocation.zones[0].id) });
    assert.equal(normalSlot.status, 201, await normalSlot.clone().text());
    const normalPost = await api("/api/school-radio/noticeboard", { method: "POST", cookie, body: postBody("locationId", publicLocation.id) });
    assert.equal(normalPost.status, 201, await normalPost.clone().text());

    await db.subscription.update({ where: { organisationId }, data: { planId: organisationsPlan.id } });
    const organisationsStation = await db.station.create({ data: {
      organisationId, productFamily: "ORGANISATIONS", name: "Fictional organisation station",
      slug: `c9-organisations-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const organisationsChannel = await db.channel.create({ data: {
      organisationId, stationId: organisationsStation.id, name: "Fictional organisation channel",
      slug: `c9-organisations-channel-${suffix}`, status: "ACTIVE"
    } });
    const organisationsAutoDj = await db.autoDjPolicy.create({ data: {
      organisationId, channelId: organisationsChannel.id, targetType: "ORGANISATIONS_CHANNEL"
    } });
    const mixedRightsStation = await db.station.create({ data: {
      organisationId, productFamily: "ORGANISATIONS", name: "Fictional mixed-rights station",
      slug: `c9-mixed-rights-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const privateRightsChannel = await db.channel.create({ data: {
      organisationId, stationId: mixedRightsStation.id, musicRightsUse: "CORRECTIONS_RADIO",
      name: "Fictional private-rights channel", slug: `c9-private-rights-channel-${suffix}`, status: "ACTIVE"
    } });
    const privateRightsPolicy = await db.autoDjPolicy.create({ data: {
      organisationId, channelId: privateRightsChannel.id, targetType: "ORGANISATIONS_CHANNEL",
      rightsUse: "CORRECTIONS_RADIO"
    } });
    const facilityAssignedStation = await db.station.create({ data: {
      organisationId, productFamily: "ORGANISATIONS", name: "Fictional legacy assigned station",
      slug: `c9-legacy-assigned-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const facilityAssignedChannel = await db.channel.create({ data: {
      organisationId, stationId: facilityAssignedStation.id, musicRightsUse: "ORGANISATIONS_RADIO",
      name: "Fictional legacy assigned channel", slug: `c9-legacy-assigned-channel-${suffix}`, status: "ACTIVE"
    } });
    const facilityAssignedPolicy = await db.autoDjPolicy.create({ data: {
      organisationId, channelId: facilityAssignedChannel.id, targetType: "ORGANISATIONS_CHANNEL",
      rightsUse: "ORGANISATIONS_RADIO"
    } });
    // An expired assignment still proves that this otherwise ordinary-rights
    // station carried private facility audio and cannot enter the public UI.
    await db.channelAssignment.create({ data: {
      channelId: facilityAssignedChannel.id, zoneId: privateFacility.zones[0].id,
      activeFrom: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      activeTo: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    } });
    const privateStation = await db.station.create({ data: {
      organisationId, productFamily: "CORRECTIONS", name: "Fictional private station",
      slug: `c9-private-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const privateChannel = await db.channel.create({ data: {
      organisationId, stationId: privateStation.id, musicRightsUse: "CORRECTIONS_RADIO",
      name: "Fictional private channel", slug: `c9-private-channel-${suffix}`, status: "ACTIVE"
    } });
    const privateAutoDj = await db.autoDjPolicy.create({ data: {
      organisationId, channelId: privateChannel.id, rightsUse: "CORRECTIONS_RADIO"
    } });
    const legacyPrivateStation = await db.station.create({ data: {
      organisationId, name: "Fictional legacy private station",
      slug: `c9-legacy-private-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    await db.channel.create({ data: {
      organisationId, stationId: legacyPrivateStation.id, musicRightsUse: "CORRECTIONS_RADIO",
      name: "Fictional legacy private channel", slug: `c9-legacy-private-channel-${suffix}`, status: "ACTIVE"
    } });
    const historical = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional historical mixed announcement", body: "Fictional only",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [publicLocation.id, privateFacility.id],
      targetStationIds: [], createdByUserId: userId
    } });
    const privateOnlyAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional private-only historical announcement", body: "Private fictional body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [privateFacility.id],
      targetStationIds: [], createdByUserId: userId
    } });
    const untargetedAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional organisation-wide announcement", body: "Fictional public body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [],
      targetStationIds: [], createdByUserId: userId
    } });
    const stationAndPrivateAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional station and private announcement", body: "Fictional shared body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [privateFacility.id],
      targetStationIds: [organisationsStation.id], createdByUserId: userId
    } });
    const privateStationAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional private-station-only announcement", body: "Private station fictional body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [],
      targetStationIds: [privateStation.id], createdByUserId: userId
    } });
    const mixedStationAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional mixed-station announcement", body: "Fictional shared station body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [],
      targetStationIds: [organisationsStation.id, privateStation.id], createdByUserId: userId
    } });
    const legacyStationAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional legacy private-station announcement", body: "Private legacy station body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [],
      targetStationIds: [legacyPrivateStation.id], createdByUserId: userId
    } });
    const facilityAssignedAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional facility-assigned announcement", body: "Private assigned station body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [],
      targetStationIds: [facilityAssignedStation.id], createdByUserId: userId
    } });
    const missingLocationId = randomUUID();
    const missingStationId = randomUUID();
    const stalePrivateAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional deleted private location announcement", body: "Private deleted location body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [missingLocationId], targetStationIds: [], createdByUserId: userId
    } });
    const staleStationAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional deleted private station announcement", body: "Private deleted station body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [], targetStationIds: [missingStationId], createdByUserId: userId
    } });
    const mixedStaleAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional public and deleted target announcement", body: "Public mixed stale body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [publicLocation.id, missingLocationId],
      targetStationIds: [organisationsStation.id, missingStationId], createdByUserId: userId
    } });
    const retiredFacilityLocation = await db.location.create({ data: {
      organisationId, name: "Fictional retired private facility", slug: `c9-retired-private-${suffix}`
    } });
    await db.auditLog.create({ data: {
      organisationId, actorUserId: userId, action: "CORRECTIONS_FACILITY_CREATED",
      entityType: "Location", entityId: retiredFacilityLocation.id
    } });
    const retiredFacilityAnnouncement = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional retired facility announcement", body: "Private retired facility body",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [retiredFacilityLocation.id],
      targetStationIds: [], createdByUserId: userId
    } });
    const eventWindow = { startsAt: new Date(Date.now() + 48 * 60 * 60 * 1000), endsAt: new Date(Date.now() + 49 * 60 * 60 * 1000), timezone: "UTC" };
    const privateEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional private Inside event", description: "Private event fictional details",
      stationId: privateStation.id, channelId: privateChannel.id, fallbackAutoDjPolicyId: privateAutoDj.id,
      ...eventWindow, createdByUserId: userId
    } });
    const privateFallbackEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional private fallback event", description: "Private fallback fictional details",
      stationId: organisationsStation.id, channelId: organisationsChannel.id,
      fallbackAutoDjPolicyId: privateAutoDj.id, ...eventWindow, createdByUserId: userId
    } });
    const legacyPrivateEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional legacy private event", description: "Private legacy event details",
      stationId: legacyPrivateStation.id, ...eventWindow, createdByUserId: userId
    } });
    const facilityAssignedEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional facility-assigned event", description: "Private assigned event details",
      stationId: facilityAssignedStation.id, channelId: facilityAssignedChannel.id,
      fallbackAutoDjPolicyId: facilityAssignedPolicy.id, ...eventWindow, createdByUserId: userId
    } });
    const publicEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional public organisation event", stationId: organisationsStation.id,
      channelId: organisationsChannel.id, fallbackAutoDjPolicyId: organisationsAutoDj.id,
      ...eventWindow, createdByUserId: userId
    } });
    const untargetedEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional untargeted organisation event", ...eventWindow, createdByUserId: userId
    } });
    const staleStationEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional deleted private station event", description: "Private deleted station event body",
      stationId: missingStationId, ...eventWindow, createdByUserId: userId
    } });
    const staleChannelEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional deleted private channel event", description: "Private deleted channel event body",
      channelId: randomUUID(), ...eventWindow, createdByUserId: userId
    } });
    const stalePolicyEvent = await db.organisationEvent.create({ data: {
      organisationId, title: "Fictional deleted private policy event", description: "Private deleted policy event body",
      fallbackAutoDjPolicyId: randomUUID(), ...eventWindow, createdByUserId: userId
    } });
    const privateBranch = await db.organisationBranchAssignment.create({ data: {
      organisationId, organisationMemberId: member.id, locationId: privateFacility.id,
      permission: "MANAGER", createdByUserId: userId
    } });
    const workspace = await api("/api/organisations/workspace", { cookie });
    assert.equal(workspace.status, 200, await workspace.clone().text());
    const data = await workspace.json();
    assert.ok(data.locations.some(({ id }) => id === publicLocation.id));
    assert.ok(!data.locations.some(({ id }) => id === privateFacility.id));
    assert.ok(!data.branchAssignments.some(({ id }) => id === privateBranch.id));
    assert.deepEqual(data.announcements.find(({ id }) => id === historical.id)?.targetLocationIds, [publicLocation.id]);
    assert.ok(!data.announcements.some(({ id }) => id === privateOnlyAnnouncement.id));
    assert.ok(!JSON.stringify(data).includes(privateOnlyAnnouncement.body));
    assert.ok(data.announcements.some(({ id }) => id === untargetedAnnouncement.id));
    assert.deepEqual(data.announcements.find(({ id }) => id === stationAndPrivateAnnouncement.id)?.targetLocationIds, []);
    assert.deepEqual(data.announcements.find(({ id }) => id === stationAndPrivateAnnouncement.id)?.targetStationIds, [organisationsStation.id]);
    assert.ok(!data.announcements.some(({ id }) => id === privateStationAnnouncement.id));
    assert.ok(!JSON.stringify(data).includes(privateStationAnnouncement.body));
    assert.ok(!data.announcements.some(({ id }) => id === legacyStationAnnouncement.id));
    assert.ok(!JSON.stringify(data).includes(legacyStationAnnouncement.body));
    assert.ok(!data.announcements.some(({ id }) => id === facilityAssignedAnnouncement.id));
    assert.ok(!JSON.stringify(data).includes(facilityAssignedAnnouncement.body));
    for (const hidden of [stalePrivateAnnouncement, staleStationAnnouncement, retiredFacilityAnnouncement]) {
      assert.ok(!data.announcements.some(({ id }) => id === hidden.id));
      assert.ok(!JSON.stringify(data).includes(hidden.body));
    }
    assert.deepEqual(data.announcements.find(({ id }) => id === mixedStaleAnnouncement.id)?.targetLocationIds, [publicLocation.id]);
    assert.deepEqual(data.announcements.find(({ id }) => id === mixedStaleAnnouncement.id)?.targetStationIds, [organisationsStation.id]);
    assert.ok(!data.locations.some(({ id }) => id === retiredFacilityLocation.id));
    assert.deepEqual(data.announcements.find(({ id }) => id === mixedStationAnnouncement.id)?.targetStationIds, [organisationsStation.id]);
    assert.ok(!data.events.some(({ id }) => id === privateEvent.id || id === privateFallbackEvent.id || id === legacyPrivateEvent.id || id === facilityAssignedEvent.id));
    assert.ok(!JSON.stringify(data).includes(privateEvent.description));
    assert.ok(!JSON.stringify(data).includes(privateFallbackEvent.description));
    assert.ok(!JSON.stringify(data).includes(legacyPrivateEvent.description));
    assert.ok(!JSON.stringify(data).includes(facilityAssignedEvent.description));
    assert.ok(data.events.some(({ id }) => id === publicEvent.id));
    assert.ok(data.events.some(({ id }) => id === untargetedEvent.id));
    for (const hidden of [staleStationEvent, staleChannelEvent, stalePolicyEvent]) {
      assert.ok(!data.events.some(({ id }) => id === hidden.id));
      assert.ok(!JSON.stringify(data).includes(hidden.description));
    }
    assert.deepEqual(data.autoDjPolicies.find(({ id }) => id === organisationsAutoDj.id)?.name, organisationsChannel.name);
    assert.ok(!data.stations.some(({ id }) => id === mixedRightsStation.id));
    assert.ok(!data.stations.some(({ id }) => id === facilityAssignedStation.id));
    assert.ok(data.stations.some(({ id }) => id === organisationsStation.id));
    assert.ok(!data.autoDjPolicies.some(({ id }) => id === privateRightsPolicy.id));
    assert.ok(!data.autoDjPolicies.some(({ id }) => id === facilityAssignedPolicy.id));
    assert.ok(!JSON.stringify(data).includes(privateRightsChannel.name));
    assert.ok(!JSON.stringify(data).includes(facilityAssignedChannel.name));
    const channelList = await api("/api/product-channels?product=ORGANISATIONS", { cookie });
    assert.equal(channelList.status, 200, await channelList.clone().text());
    assert.ok(!JSON.stringify(await channelList.json()).includes(privateRightsChannel.name));
    const setup = await api("/dashboard/organisations/setup", { cookie });
    assert.equal(setup.status, 200, await setup.clone().text());
    assert.ok(!(await setup.text()).includes(privateRightsChannel.name));
    const dashboard = await api("/dashboard/organisations", { cookie });
    assert.equal(dashboard.status, 200, await dashboard.clone().text());
    assert.match(await dashboard.text(), /Count hidden while private Inside resources exist/);

    // Generic station management is not a Corrections facility workspace.
    // An organisation member without an Inside facility grant must not reach
    // private stations, including a legacy or mixed-family station identified
    // by a Corrections-rights channel.
    const generalStationPages = ["", "/setup", "/website", "/public-player", "/listener-requests"];
    for (const suffixPath of generalStationPages) {
      const normalPage = await api(`/stations/${organisationsStation.id}${suffixPath}`, { cookie });
      assert.equal(normalPage.status, 200, `Ordinary Organisations station page ${suffixPath} should remain available`);
      for (const privateId of [privateStation.id, legacyPrivateStation.id, mixedRightsStation.id, facilityAssignedStation.id]) {
        const privatePage = await api(`/stations/${privateId}${suffixPath}`, { cookie });
        assert.equal(privatePage.status, 404, `Private station page ${suffixPath} must not be available`);
      }
    }

    const action = (body) => api("/api/organisations/workspace", { method: "POST", cookie, body });
    const privateAnnouncement = await action({ action: "CREATE_ANNOUNCEMENT", title: "Fictional general notice", body: "Fictional body", surfaces: ["WEB_PLAYER"], targetLocationIds: [privateFacility.id] });
    assert.equal(privateAnnouncement.status, 409, await privateAnnouncement.clone().text());
    const privateAssignment = await action({ action: "ASSIGN_BRANCH", organisationMemberId: member.id, locationId: privateFacility.id, permission: "MANAGER" });
    assert.equal(privateAssignment.status, 409, await privateAssignment.clone().text());
    const approveHistorical = await action({ action: "APPROVE_ANNOUNCEMENT", announcementId: historical.id });
    assert.equal(approveHistorical.status, 409, await approveHistorical.clone().text());
    const archivePrivateStation = await action({ action: "ARCHIVE_ANNOUNCEMENT", announcementId: privateStationAnnouncement.id });
    assert.equal(archivePrivateStation.status, 409, await archivePrivateStation.clone().text());
    const activatePrivateEvent = await action({ action: "TRANSITION_EVENT", eventId: privateEvent.id, status: "READY" });
    assert.equal(activatePrivateEvent.status, 409, await activatePrivateEvent.clone().text());
    for (const hidden of [staleStationEvent, staleChannelEvent, stalePolicyEvent]) {
      const transition = await action({ action: "TRANSITION_EVENT", eventId: hidden.id, status: "READY" });
      assert.equal(transition.status, 409, await transition.clone().text());
    }
    const archiveStaleAnnouncement = await action({ action: "ARCHIVE_ANNOUNCEMENT", announcementId: stalePrivateAnnouncement.id });
    assert.equal(archiveStaleAnnouncement.status, 409, await archiveStaleAnnouncement.clone().text());
    const archiveRetiredAnnouncement = await action({ action: "ARCHIVE_ANNOUNCEMENT", announcementId: retiredFacilityAnnouncement.id });
    assert.equal(archiveRetiredAnnouncement.status, 409, await archiveRetiredAnnouncement.clone().text());
    const assignRetiredLocation = await action({ action: "ASSIGN_BRANCH", organisationMemberId: member.id, locationId: retiredFacilityLocation.id, permission: "MANAGER" });
    assert.equal(assignRetiredLocation.status, 409, await assignRetiredLocation.clone().text());
    const privateStationTarget = await action({ action: "CREATE_ANNOUNCEMENT", title: "Fictional private station target", body: "Fictional body", surfaces: ["WEB_PLAYER"], targetStationIds: [mixedRightsStation.id] });
    assert.equal(privateStationTarget.status, 409, await privateStationTarget.clone().text());
    const assignedStationTarget = await action({ action: "CREATE_ANNOUNCEMENT", title: "Fictional assigned station target", body: "Fictional body", surfaces: ["WEB_PLAYER"], targetStationIds: [facilityAssignedStation.id] });
    assert.equal(assignedStationTarget.status, 409, await assignedStationTarget.clone().text());
    const archiveAssignedStation = await action({ action: "ARCHIVE_ANNOUNCEMENT", announcementId: facilityAssignedAnnouncement.id });
    assert.equal(archiveAssignedStation.status, 409, await archiveAssignedStation.clone().text());
    const privateChannelEvent = await action({ action: "CREATE_EVENT", title: "Fictional blocked event", ...eventWindow, channelId: privateRightsChannel.id });
    assert.equal(privateChannelEvent.status, 409, await privateChannelEvent.clone().text());
    const privateStationEvent = await action({ action: "CREATE_EVENT", title: "Fictional blocked station event", ...eventWindow, stationId: mixedRightsStation.id });
    assert.equal(privateStationEvent.status, 409, await privateStationEvent.clone().text());
    const privateFallbackEventAttempt = await action({ action: "CREATE_EVENT", title: "Fictional blocked fallback event", ...eventWindow, fallbackAutoDjPolicyId: privateRightsPolicy.id });
    assert.equal(privateFallbackEventAttempt.status, 409, await privateFallbackEventAttempt.clone().text());
    for (const target of [
      { stationId: facilityAssignedStation.id },
      { channelId: facilityAssignedChannel.id },
      { fallbackAutoDjPolicyId: facilityAssignedPolicy.id }
    ]) {
      const assignedEvent = await action({ action: "CREATE_EVENT", title: "Fictional blocked facility event", ...eventWindow, ...target });
      assert.equal(assignedEvent.status, 409, await assignedEvent.clone().text());
    }
    const activateAssignedEvent = await action({ action: "TRANSITION_EVENT", eventId: facilityAssignedEvent.id, status: "READY" });
    assert.equal(activateAssignedEvent.status, 409, await activateAssignedEvent.clone().text());
    const publicAnnouncement = await action({ action: "CREATE_ANNOUNCEMENT", title: "Fictional school venue notice", body: "Fictional body", surfaces: ["WEB_PLAYER"], targetLocationIds: [publicLocation.id] });
    assert.equal(publicAnnouncement.status, 201, await publicAnnouncement.clone().text());
    const publicAssignment = await action({ action: "ASSIGN_BRANCH", organisationMemberId: member.id, locationId: publicLocation.id, permission: "MANAGER" });
    assert.equal(publicAssignment.status, 200, await publicAssignment.clone().text());
  } finally {
    try {
      if (organisationId) await db.schoolNoticeboardPost.deleteMany({ where: { organisationId } });
      if (organisationId) await db.schoolBroadcastSlot.deleteMany({ where: { organisationId } });
      if (organisationId) await db.schoolAnnouncement.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisationBranchAssignment.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisationAnnouncement.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisationEvent.deleteMany({ where: { organisationId } });
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
