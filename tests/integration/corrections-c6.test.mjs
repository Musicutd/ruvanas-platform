import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3106";
const secret = process.env.SESSION_SECRET;

async function api(path, { method = "GET", body, cookie, instanceId } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { origin: baseUrl, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(instanceId ? { "x-ruvanas-player-instance": instanceId } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("C6 private standard, Priority, Emergency, proof and safe return", async () => {
  const databaseUrl = process.env.DATABASE_URL || "";
  const isolatedLocalDatabase = /^postgresql:\/\/[^@]+@127\.0\.0\.1:55433\/ruvanas_c6(?:_final)?(?:\?|$)/.test(databaseUrl);
  const isolatedGithubDatabase = process.env.GITHUB_ACTIONS === "true"
    && databaseUrl === "postgresql://postgres:postgres@localhost:5432/ruvanas";
  if (!(isolatedLocalDatabase || isolatedGithubDatabase) || !secret || secret.length < 32) {
    throw new Error("C6 integration must use the isolated local or GitHub Actions test database and test secret.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const password = `C6-local-${randomUUID()}!`;
  const token = `c6-player-${randomUUID()}`;
  const instanceId = randomUUID();
  let organisation, outsiderOrganisation, plan;
  const users = [];
  try {
    plan = await db.plan.create({ data: { name: `C6 ${suffix}`, code: `C6_${suffix}`, productFamily: "CORRECTIONS", tierNumber: 2, monthlyPriceCents: 29900, storageLimitGb: 10, listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true, stationLimit: 2 } });
    organisation = await db.organisation.create({ data: { name: `C6 ${suffix}`, slug: `c6-${suffix}` } });
    outsiderOrganisation = await db.organisation.create({ data: { name: `C6 outsider ${suffix}`, slug: `c6-other-${suffix}` } });
    await db.subscription.createMany({ data: [{ organisationId: organisation.id, planId: plan.id, status: "ACTIVE" }, { organisationId: outsiderOrganisation.id, planId: plan.id, status: "ACTIVE" }] });
    async function member(role, label, org = organisation) {
      const user = await db.user.create({ data: { name: label, email: `${label}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role } });
      const membership = await db.organisationMember.create({ data: { organisationId: org.id, userId: user.id, role } });
      users.push(user);
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      return { user, membership, cookie: login.cookie };
    }
    const owner = await member("OWNER", "c6-owner");
    const manager = await member("MANAGER", "c6-manager");
    const contributor = await member("CONTENT_EDITOR", "c6-contributor");
    const viewer = await member("VIEWER", "c6-viewer");
    const outsider = await member("OWNER", "c6-outsider", outsiderOrganisation);
    const configuredAt = new Date();
    const location = await db.location.create({ data: { organisationId: organisation.id, name: "Synthetic C6 facility", slug: `c6-facility-${suffix}`, status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT", zones: { create: [{ name: "Wing A", slug: "wing-a", status: "ACTIVE" }, { name: "Wing B", slug: "wing-b", status: "ACTIVE" }] }, correctionsFacility: { create: { policyConfiguredAt: configuredAt, priorityEnabled: true, emergencyEnabled: true } } }, include: { zones: true } });
    const [wingA, wingB] = location.zones.sort((a, b) => a.name.localeCompare(b.name));
    await db.correctionsProfile.create({ data: { organisationId: organisation.id, policyConfiguredAt: configuredAt } });
    const station = await db.station.create({ data: { organisationId: organisation.id, productFamily: "CORRECTIONS", name: "C6 Inside", slug: `c6-inside-${suffix}`, status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128 } });
    const channel = await db.channel.create({ data: { organisationId: organisation.id, stationId: station.id, name: "C6 private", slug: `c6-private-${suffix}`, status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO" } });
    await db.channelAssignment.createMany({ data: [wingA, wingB].map((zone) => ({ channelId: channel.id, zoneId: zone.id, activeFrom: new Date(Date.now() - 60000) })) });
    const online = await db.player.create({ data: { organisationId: organisation.id, zoneId: wingA.id, name: "C6 online player", status: "ONLINE", sessionTokenHash: hashPlayerToken(token, secret), enrolledAt: new Date(), lastHeartbeatAt: new Date() } });
    const offline = await db.player.create({ data: { organisationId: organisation.id, zoneId: wingB.id, name: "C6 offline player", status: "OFFLINE", sessionTokenHash: hashPlayerToken(`c6-offline-${randomUUID()}`, secret), enrolledAt: new Date(), lastHeartbeatAt: new Date(Date.now() - 600000) } });
    const playerCookie = `ruvanas_player=${token}`;
    const media = await db.mediaAsset.create({ data: { organisationId: organisation.id, libraryType: "ORGANISATION_PROMO", name: "C6 test audio", originalName: "c6.mp3", storageKey: `c6-test/${suffix}/c6.mp3`, mimeType: "audio/mpeg", sizeBytes: BigInt(1024), durationSeconds: 30, mediaType: "ANNOUNCEMENT", status: "READY" } });
    const promo = await db.promoAsset.create({ data: { organisationId: organisation.id, name: "C6 test audio", mediaType: "ANNOUNCEMENT" } });
    const version = await db.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: media.id, version: 1, status: "APPROVED", qcStatus: "PASSED", checksumSha256: "a".repeat(64) } });
    await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: version.id } });
    const unapproved = await db.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: media.id, version: 2, status: "DRAFT", qcStatus: "PENDING" } });
    const otherMedia = await db.mediaAsset.create({ data: { organisationId: outsiderOrganisation.id, libraryType: "ORGANISATION_PROMO", name: "Other tenant audio", originalName: "other.mp3", storageKey: `c6-test/${suffix}/other.mp3`, mimeType: "audio/mpeg", sizeBytes: BigInt(1024), durationSeconds: 30, mediaType: "ANNOUNCEMENT", status: "READY" } });
    const otherPromo = await db.promoAsset.create({ data: { organisationId: outsiderOrganisation.id, name: "Other tenant audio", mediaType: "ANNOUNCEMENT" } });
    const otherVersion = await db.promoVersion.create({ data: { promoAssetId: otherPromo.id, mediaAssetId: otherMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED", checksumSha256: "b".repeat(64) } });
    await db.promoAsset.update({ where: { id: otherPromo.id }, data: { currentApprovedVersionId: otherVersion.id } });
    const staffPath = `/api/corrections/facilities/${location.id}/staff`;
    assert.equal((await api(staffPath, { method: "POST", cookie: owner.cookie, body: { memberId: owner.membership.id, permission: "MANAGER", canEmergencyActivate: true, canEmergencyClear: true } })).status, 200);
    assert.equal((await api(staffPath, { method: "POST", cookie: owner.cookie, body: { memberId: manager.membership.id, permission: "MANAGER", canPriorityActivate: true, canPriorityStop: true } })).status, 200);
    assert.equal((await api(staffPath, { method: "POST", cookie: owner.cookie, body: { memberId: contributor.membership.id, permission: "EDITOR" } })).status, 200);
    assert.equal((await api(staffPath, { method: "POST", cookie: owner.cookie, body: { memberId: viewer.membership.id, permission: "VIEWER" } })).status, 200);
    for (const deniedVersion of [unapproved.id, otherVersion.id]) assert.equal((await api("/api/corrections/announcements", { method: "POST", cookie: owner.cookie, body: { facilityId: location.id, title: "Denied source", promoVersionId: deniedVersion } })).status, 409);
    assert.equal((await api("/api/corrections/announcements", { method: "POST", cookie: owner.cookie, body: { facilityId: randomUUID(), title: "Wrong facility", promoVersionId: version.id } })).status, 403);
    await db.subscription.update({ where: { organisationId: organisation.id }, data: { status: "SUSPENDED" } });
    assert.notEqual((await api("/api/corrections/announcements", { method: "POST", cookie: owner.cookie, body: { facilityId: location.id, title: "Suspended account", promoVersionId: version.id } })).status, 201);
    await db.subscription.update({ where: { organisationId: organisation.id }, data: { status: "ACTIVE" } });

    const announcementCreate = await api("/api/corrections/announcements", { method: "POST", cookie: contributor.cookie, body: { facilityId: location.id, title: "C6 approved message", promoVersionId: version.id } });
    assert.equal(announcementCreate.status, 201, JSON.stringify(announcementCreate.body));
    const announcementId = announcementCreate.body.announcement.id;
    assert.equal((await api(`/api/corrections/announcements/${announcementId}/approve`, { method: "POST", cookie: contributor.cookie })).status, 403);
    assert.equal((await api(`/api/corrections/announcements/${announcementId}/approve`, { method: "POST", cookie: manager.cookie })).status, 200);
    const standardAt = new Date(Date.now() + 6 * 60000).toISOString();
    const scheduled = await api(`/api/corrections/announcements/${announcementId}/schedule`, { method: "POST", cookie: manager.cookie, body: { zoneIds: [wingA.id], startsAt: standardAt } });
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
    await db.playoutIntent.updateMany({ where: { correctionsAnnouncementId: announcementId, correctionsOverrideId: null }, data: { plannedStart: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() + 120000) } });
    const normal = await api("/api/player/manifest", { cookie: playerCookie, instanceId });
    assert.equal(normal.status, 200, JSON.stringify(normal.body));
    assert.ok(normal.body.insertions.some((item) => item.programmingSource === "CORRECTIONS_STANDARD"));
    const key = randomUUID();
    const priorityInput = { facilityId: location.id, zoneIds: [wingA.id], announcementId, type: "PRIORITY", category: "URGENT_FACILITY_NOTICE", idempotencyKey: key };
    for (const actor of [contributor, viewer, outsider]) assert.notEqual((await api("/api/corrections/overrides", { method: "POST", cookie: actor.cookie, body: priorityInput })).status, 200);
    const priority = await api("/api/corrections/overrides", { method: "POST", cookie: manager.cookie, body: priorityInput });
    assert.equal(priority.status, 200, JSON.stringify(priority.body));
    assert.equal((await api("/api/corrections/overrides", { method: "POST", cookie: manager.cookie, body: priorityInput })).body.alreadyStarted, true);
    const duringPriority = await api("/api/player/manifest", { cookie: playerCookie, instanceId });
    assert.equal(duringPriority.body.activeOverride.type, "PRIORITY");
    assert.ok(duringPriority.body.insertions.every((item) => item.programmingSource === "CORRECTIONS_PRIORITY"));
    const priorityItem = duringPriority.body.insertions[0];
    const proof = (manifest, item) => ({ eventId: randomUUID(), manifestVersion: manifest.version, proofToken: item.proofToken, programmingSourceProofToken: item.programmingSourceProofToken, scheduleItemId: item.scheduleItemId, itemType: item.itemType, programmingSource: item.programmingSource, eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 });
    const preemptedStandard = normal.body.insertions.find((item) => item.programmingSource === "CORRECTIONS_STANDARD");
    assert.equal((await api("/api/player/proof-of-play", { method: "POST", cookie: playerCookie, body: { events: [proof(normal.body, preemptedStandard)] } })).status, 400);
    assert.equal((await api("/api/player/proof-of-play", { method: "POST", cookie: playerCookie, body: { events: [proof(duringPriority.body, priorityItem)] } })).status, 200);
    const afterPriority = await api("/api/player/manifest", { cookie: playerCookie, instanceId });
    assert.equal(afterPriority.body.activeOverride, null);
    assert.ok(afterPriority.body.insertions.some((item) => item.programmingSource === "CORRECTIONS_STANDARD"));
    const resumedItem = afterPriority.body.insertions.find((item) => item.programmingSource === "CORRECTIONS_STANDARD");
    assert.equal((await api("/api/player/proof-of-play", { method: "POST", cookie: playerCookie, body: { events: [{ ...proof(afterPriority.body, resumedItem), eventType: "STARTED", positionSeconds: 0 }] } })).status, 200);
    assert.equal(await db.auditLog.count({ where: { organisationId: organisation.id, action: "CORRECTIONS_RESTORATION_CONFIRMED", entityId: priority.body.override.id } }), 1);

    const priorityAgain = await api("/api/corrections/overrides", { method: "POST", cookie: manager.cookie, body: { ...priorityInput, idempotencyKey: randomUUID() } });
    assert.equal(priorityAgain.status, 200, JSON.stringify(priorityAgain.body));

    const emergencyInput = { facilityId: location.id, zoneIds: [wingA.id, wingB.id], announcementId, type: "EMERGENCY", category: "EMERGENCY_INSTRUCTION", confirmation: "START EMERGENCY", idempotencyKey: randomUUID() };
    for (const actor of [contributor, viewer, manager, outsider]) assert.notEqual((await api("/api/corrections/overrides", { method: "POST", cookie: actor.cookie, body: emergencyInput })).status, 200);
    const emergency = await api("/api/corrections/overrides", { method: "POST", cookie: owner.cookie, body: emergencyInput });
    assert.equal(emergency.status, 200, JSON.stringify(emergency.body));
    assert.equal((await db.correctionsOverride.findUnique({ where: { id: priorityAgain.body.override.id } })).status, "SUPERSEDED");
    assert.equal(emergency.body.offlinePlayers.length, 1);
    assert.equal(emergency.body.offlinePlayers[0].id, offline.id);
    assert.equal((await api("/api/corrections/overrides", { method: "POST", cookie: manager.cookie, body: { ...priorityInput, idempotencyKey: randomUUID() } })).status, 409);
    const duringEmergency = await api("/api/player/manifest", { cookie: playerCookie, instanceId });
    assert.equal(duringEmergency.body.activeOverride.type, "EMERGENCY");
    assert.ok(duringEmergency.body.insertions.every((item) => item.programmingSource === "CORRECTIONS_EMERGENCY"));
    assert.equal((await api(`/api/corrections/overrides/${emergency.body.override.id}/clear`, { method: "POST", cookie: manager.cookie })).status, 403);
    assert.equal((await api(`/api/corrections/overrides/${emergency.body.override.id}/clear`, { method: "POST", cookie: owner.cookie })).status, 200);
    const restored = await api("/api/player/manifest", { cookie: playerCookie, instanceId });
    assert.equal(restored.body.activeOverride, null);
    assert.ok(restored.body.insertions.some((item) => item.programmingSource === "CORRECTIONS_STANDARD"));
    assert.equal(await db.proofOfPlayEvent.count({ where: { playerId: offline.id } }), 0);
    const expiring = await api("/api/corrections/overrides", { method: "POST", cookie: manager.cookie, body: { ...priorityInput, idempotencyKey: randomUUID() } });
    assert.equal(expiring.status, 200, JSON.stringify(expiring.body));
    await db.correctionsOverride.update({ where: { id: expiring.body.override.id }, data: { startedAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 1000) } });
    const workspace = await api(`/api/corrections/announcements?facilityId=${location.id}`, { cookie: owner.cookie });
    assert.equal(workspace.status, 200, JSON.stringify(workspace.body));
    assert.equal((await db.correctionsOverride.findUnique({ where: { id: expiring.body.override.id } })).status, "EXPIRED");
    assert.equal(await db.auditLog.count({ where: { organisationId: organisation.id, action: "CORRECTIONS_OVERRIDE_EXPIRED", entityId: expiring.body.override.id } }), 1);
  } finally {
    if (organisation) {
      await db.proofOfPlayEvent.deleteMany({ where: { organisationId: organisation.id } });
      await db.playoutIntent.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsOverride.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsAnnouncement.deleteMany({ where: { organisationId: organisation.id } });
      await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId: organisation.id } } });
      await db.promoAsset.deleteMany({ where: { organisationId: organisation.id } });
      await db.mediaAsset.deleteMany({ where: { organisationId: organisation.id } });
      await db.playerListenerLease.deleteMany({ where: { organisationId: organisation.id } });
      await db.player.deleteMany({ where: { organisationId: organisation.id } });
      await db.channelAssignment.deleteMany({ where: { channel: { organisationId: organisation.id } } });
      await db.channel.deleteMany({ where: { organisationId: organisation.id } });
      await db.station.deleteMany({ where: { organisationId: organisation.id } });
      await db.organisation.delete({ where: { id: organisation.id } });
    }
    if (outsiderOrganisation) {
      await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId: outsiderOrganisation.id } } });
      await db.promoAsset.deleteMany({ where: { organisationId: outsiderOrganisation.id } });
      await db.mediaAsset.deleteMany({ where: { organisationId: outsiderOrganisation.id } });
      await db.organisation.delete({ where: { id: outsiderOrganisation.id } });
    }
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});
