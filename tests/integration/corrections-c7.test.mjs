import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";
import { correctionsRenderEvidence } from "../../lib/corrections-workflow.mjs";
import { localDateTimeParts } from "../../lib/opening-hours.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

function syntheticWav(frequency) {
  const sampleRate = 8000;
  const samples = sampleRate * 30;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii"); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii"); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii"); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 8000), 44 + index * 2);
  }
  return wav;
}

function observedTone(wav) {
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 8000);
  let crossings = 0;
  for (let index = 1; index < 8000; index += 1) {
    if (wav.readInt16LE(44 + (index - 1) * 2) <= 0 && wav.readInt16LE(44 + index * 2) > 0) crossings += 1;
  }
  return crossings;
}

async function api(path, { method = "GET", body, cookie, instanceId } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { origin: baseUrl,
    ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}),
    ...(instanceId ? { "x-ruvanas-player-instance": instanceId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("C7 network routes require current Tier 4 and explicit cross-facility authority", async () => {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (process.env.GITHUB_ACTIONS !== "true" || databaseUrl !== "postgresql://postgres:postgres@localhost:5432/ruvanas" ||
      !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C7 integration runs only against the isolated GitHub Actions test database.");
  }
  const db = new PrismaClient();
  const mediaObjects = new Map();
  const mediaStore = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1:9107").pathname;
    const prefix = "/c7-test/";
    const bytes = path.startsWith(prefix) ? mediaObjects.get(decodeURIComponent(path.slice(prefix.length))) : null;
    if (!bytes || request.method !== "GET") { response.writeHead(404); response.end(); return; }
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
    const start = match ? Number(match[1]) : 0;
    const end = match ? Math.min(match[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1) : bytes.length - 1;
    if (start > end || end >= bytes.length) { response.writeHead(416); response.end(); return; }
    response.writeHead(match ? 206 : 200, { "Content-Type": "audio/wav", "Content-Length": end - start + 1,
      ...(match ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(bytes.subarray(start, end + 1));
  });
  const suffix = randomUUID().slice(0, 8);
  const password = `C7-test-${randomUUID()}!`;
  const users = [];
  let authority, outsider, plan;
  try {
    await new Promise((resolve, reject) => mediaStore.once("error", reject).listen(9107, "127.0.0.1", resolve));
    plan = await db.plan.create({ data: { name: `C7 ${suffix}`, code: `C7_${suffix}`, productFamily: "CORRECTIONS", tierNumber: 4,
      monthlyPriceCents: 49900, storageLimitGb: 10, listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true, stationLimit: 4 } });
    authority = await db.organisation.create({ data: { name: `Synthetic C7 authority ${suffix}`, slug: `c7-${suffix}` } });
    outsider = await db.organisation.create({ data: { name: `Synthetic C7 outsider ${suffix}`, slug: `c7-other-${suffix}` } });
    await db.subscription.createMany({ data: [authority, outsider].map((organisation) => ({ organisationId: organisation.id, planId: plan.id, status: "ACTIVE" })) });
    async function member(role, label, organisation = authority) {
      const user = await db.user.create({ data: { name: label, email: `${label}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role } });
      const membership = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role } });
      users.push(user);
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      return { user, membership, cookie: login.cookie };
    }
    const owner = await member("OWNER", "c7-owner");
    const manager = await member("MANAGER", "c7-manager");
    const contributor = await member("CONTENT_EDITOR", "c7-contributor");
    const otherOwner = await member("OWNER", "c7-other", outsider);
    const facilities = [];
    for (const name of ["A", "B", "C"]) {
      const facility = await db.location.create({ data: { organisationId: authority.id, name: `Synthetic facility ${name}`, slug: `c7-${name.toLowerCase()}-${suffix}`,
        status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT", zones: { create: { name: "Wing 1", slug: "wing-1", status: "ACTIVE" } },
        correctionsFacility: { create: { policyConfiguredAt: new Date() } } } });
      facilities.push(facility);
    }
    const foreign = await db.location.create({ data: { organisationId: outsider.id, name: "Foreign facility", slug: `c7-foreign-${suffix}`,
      status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT", correctionsFacility: { create: { policyConfiguredAt: new Date() } } } });
    const group = await db.locationGroup.create({ data: { organisationId: authority.id, name: "Northern facilities", slug: `north-${suffix}`,
      locations: { create: [{ locationId: facilities[0].id }, { locationId: facilities[1].id }] } } });
    await db.correctionsFacilityGrant.create({ data: { organisationId: authority.id, organisationMemberId: manager.membership.id,
      facilityId: facilities[0].id, permission: "MANAGER", createdByUserId: owner.user.id } });

    const ownerNetwork = await api("/api/corrections/network", { cookie: owner.cookie });
    assert.equal(ownerNetwork.status, 200, JSON.stringify(ownerNetwork.body));
    assert.equal(ownerNetwork.body.totals.facilities, 3);
    assert.equal(ownerNetwork.body.groups.find((item) => item.id === group.id)?.facilityIds.length, 2);
    assert.equal(ownerNetwork.body.permissions.distribute, true);
    const emptyReport = await fetch(`${baseUrl}/api/corrections/network/report/export`, { headers: { cookie: owner.cookie } });
    assert.equal(emptyReport.status, 200);
    assert.match(await emptyReport.text(), /^occurredAt,facility,facilityId,classification,kind,source,status,proofEventId,playoutIntentId,sourceRevision,programmeId,submissionId,rehabilitationId,announcementId\r\n$/);
    assert.equal((await fetch(`${baseUrl}/api/corrections/network/report/export`, { headers: { cookie: contributor.cookie } })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/corrections/network/report/export?facilityId=${foreign.id}`, { headers: { cookie: owner.cookie } })).status, 404);
    assert.equal((await api("/api/corrections/network", { cookie: manager.cookie })).status, 403);
    assert.equal((await api("/api/corrections/network", { cookie: contributor.cookie })).status, 403);
    assert.equal((await api(`/api/corrections/network?facilityId=${foreign.id}`, { cookie: owner.cookie })).status, 404);
    assert.equal((await api(`/api/corrections/network/windows?facilityId=${facilities[1].id}`, { cookie: manager.cookie })).status, 403);
    assert.equal((await api(`/api/corrections/network/windows?facilityId=${facilities[0].id}`, { cookie: manager.cookie })).status, 200);
    assert.equal((await api("/api/corrections/network", { cookie: otherOwner.cookie })).body.totals.facilities, 1);

    const granted = await api("/api/corrections/network/grants", { method: "PUT", cookie: owner.cookie,
      body: { memberId: manager.membership.id, canView: true, canProgramme: true } });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.equal((await api("/api/corrections/network", { cookie: manager.cookie })).status, 200);
    assert.equal((await api("/api/corrections/network", { cookie: contributor.cookie })).status, 403);
    assert.equal((await api("/api/corrections/network/grants", { method: "PUT", cookie: manager.cookie,
      body: { memberId: contributor.membership.id, canView: true } })).status, 403);
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: manager.cookie,
      body: { programmeId: "not-approved", facilityIds: [facilities[1].id] } })).status, 403);
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: manager.cookie,
      body: { facilityId: facilities[1].id, kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660,
        distributionId: "not-approved", allowedContentTypes: ["PROGRAMME"] } })).status, 403);

    // Exercise the real private manifest and signed proof routes, not merely
    // the window resolver. The synthetic media metadata is isolated to CI.
    const configuredAt = new Date();
    await db.correctionsProfile.create({ data: { organisationId: authority.id, policyConfiguredAt: configuredAt } });
    const zones = await Promise.all(facilities.map((facility) => db.zone.findFirst({ where: { locationId: facility.id } })));
    const station = await db.station.create({ data: { organisationId: authority.id, productFamily: "CORRECTIONS", name: "Synthetic C7 Inside", slug: `c7-inside-${suffix}`, status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128 } });
    const channel = await db.channel.create({ data: { organisationId: authority.id, stationId: station.id, name: "Synthetic private channel", slug: `c7-private-${suffix}`, status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO" } });
    await db.channelAssignment.createMany({ data: zones.map((zone) => ({ channelId: channel.id, zoneId: zone.id, activeFrom: new Date(Date.now() - 60_000) })) });
    const players = await Promise.all(zones.map(async (zone, index) => {
      const token = `c7-${index}-${randomUUID()}`;
      const player = await db.player.create({ data: { organisationId: authority.id, zoneId: zone.id, name: `Synthetic C7 player ${index}`, status: "ONLINE",
        sessionTokenHash: hashPlayerToken(token, process.env.SESSION_SECRET), enrolledAt: new Date(), lastHeartbeatAt: new Date() } });
      return { player, cookie: `ruvanas_player=${token}`, instanceId: randomUUID() };
    }));
    async function approvedProgramme(facilityIndex, label, frequency, createdByUserId = owner.user.id) {
      const audio = syntheticWav(frequency);
      const storageKey = `c7-test/${suffix}/${label}.wav`;
      mediaObjects.set(storageKey, audio);
      const media = await db.mediaAsset.create({ data: { organisationId: authority.id, libraryType: "ORGANISATION_PROMO", name: label,
        originalName: `${label}.wav`, storageKey, mimeType: "audio/wav", sizeBytes: BigInt(audio.length),
        durationSeconds: 30, mediaType: "ANNOUNCEMENT", status: "READY" } });
      const promo = await db.promoAsset.create({ data: { organisationId: authority.id, name: label, mediaType: "ANNOUNCEMENT" } });
      const checksum = createHash("sha256").update(audio).digest("hex");
      const promoVersion = await db.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: media.id, version: 1,
        status: "APPROVED", qcStatus: "PASSED", checksumSha256: checksum } });
      await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: promoVersion.id } });
      const project = await db.audioProject.create({ data: { organisationId: authority.id, title: label, editDecision: {}, createdByUserId: owner.user.id } });
      const version = await db.audioProjectVersion.create({ data: { projectId: project.id, version: 1,
        state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: media.id }] } }, createdByUserId: owner.user.id } });
      await db.audioTake.create({ data: { organisationId: authority.id, projectId: project.id, mediaAssetId: media.id,
        promoVersionId: promoVersion.id, recordedByUserId: owner.user.id, status: "READY", sourceEditDecision: {} } });
      const render = await db.audioRender.create({ data: { organisationId: authority.id, projectId: project.id, versionId: version.id,
        outputMediaAssetId: media.id, outputPromoVersionId: promoVersion.id, requestedByUserId: owner.user.id,
        preset: "SPEECH_MP3", status: "SUCCEEDED", completedAt: new Date(), resultJson: { checksumSha256: checksum } } });
      const evidence = correctionsRenderEvidence(await db.audioRender.findUnique({ where: { id: render.id }, include: {
        outputMediaAsset: true, outputPromoVersion: true, version: { select: { state: true } },
        project: { select: { organisationId: true, createdByUserId: true, currentVersion: true, title: true } } } }));
      const programme = await db.correctionsProgramme.create({ data: { organisationId: authority.id, facilityId: facilities[facilityIndex].id,
        title: label, createdByUserId, status: "APPROVED", latestRevision: 1 } });
      const submission = await db.correctionsSubmission.create({ data: { programmeId: programme.id, organisationId: authority.id,
        facilityId: facilities[facilityIndex].id, revision: 1, renderId: render.id, sourceFingerprint: evidence.fingerprint,
        organisationPolicyVersion: 1, facilityPolicyVersion: 1, titleSnapshot: label, evidenceSnapshot: evidence,
        submittedByUserId: owner.user.id, status: "APPROVED" } });
      await db.correctionsReview.create({ data: { submissionId: submission.id, stage: "STAFF", decision: "APPROVE",
        note: "Synthetic network approval", evidenceSnapshot: {}, reviewedByUserId: manager.user.id } });
      return programme;
    }
    const central = await approvedProgramme(0, "Central C7 programme", 440);
    const localA = await approvedProgramme(0, "Facility A programme", 880);
    const localC = await approvedProgramme(2, "Facility C programme", 220);
    const grouped = await approvedProgramme(0, "Group-only C7 programme", 660);
    const groupDistribution = await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: { programmeId: grouped.id, groupId: group.id } });
    assert.equal(groupDistribution.status, 201, JSON.stringify(groupDistribution.body));
    assert.deepEqual(groupDistribution.body.targetFacilityIds, [facilities[0].id, facilities[1].id].sort(),
      "a group distribution must not silently reach facility C");
    assert.equal((await db.correctionsProgrammeDistribution.count({ where: { programmeId: grouped.id,
      targetFacilityId: facilities[2].id } })), 0);
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: facilities[2].id, kind: "CENTRAL", distributionId: groupDistribution.body.distributionIds[0],
        weekday: localDateTimeParts(new Date(), "Europe/Malta").weekday,
        startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"] } })).status, 409,
      "a raw group distribution ID cannot be scheduled at an unselected facility");
    const groupedSubmission = await db.correctionsSubmission.findFirst({ where: { programmeId: grouped.id } });
    const groupedRender = await db.audioRender.findUnique({ where: { id: groupedSubmission.renderId } });
    await db.correctionsFacility.update({ where: { locationId: facilities[1].id },
      data: { blockedTrackIds: [groupedRender.outputMediaAssetId] } });
    const blockedWindow = await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: facilities[1].id, kind: "CENTRAL", distributionId: groupDistribution.body.distributionIds[1],
        weekday: localDateTimeParts(new Date(), "Europe/Malta").weekday,
        startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"] } });
    assert.equal(blockedWindow.status, 409, "a receiving facility restriction also blocks scheduling");
    await db.correctionsFacility.update({ where: { locationId: facilities[1].id }, data: { blockedTrackIds: [] } });
    async function distribute(programmeId, facilityIds) {
      const response = await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie, body: { programmeId, facilityIds } });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return Object.fromEntries(response.body.targetFacilityIds.map((id, index) => [id, response.body.distributionIds[index]]));
    }
    const centralIds = await distribute(central.id, facilities.map((facility) => facility.id));
    const firstCentralSubmission = await db.correctionsSubmission.findFirst({ where: { programmeId: central.id, revision: 1 } });
    await db.correctionsSubmission.create({ data: { programmeId: central.id, organisationId: authority.id,
      facilityId: facilities[0].id, revision: 2, renderId: firstCentralSubmission.renderId,
      sourceFingerprint: firstCentralSubmission.sourceFingerprint, organisationPolicyVersion: 1,
      facilityPolicyVersion: 1, titleSnapshot: "Central C7 programme · revised",
      evidenceSnapshot: firstCentralSubmission.evidenceSnapshot, submittedByUserId: owner.user.id,
      status: "APPROVED", reviews: { create: { stage: "STAFF", decision: "APPROVE", note: "Synthetic revised approval",
        evidenceSnapshot: {}, reviewedByUserId: manager.user.id } } } });
    await db.correctionsProgramme.update({ where: { id: central.id }, data: { latestRevision: 2 } });
    const pinnedNetwork = await api("/api/corrections/network", { cookie: owner.cookie });
    assert.equal(pinnedNetwork.body.distributions.find((item) => item.id === centralIds[facilities[0].id])?.versionState,
      "NEW_VERSION_AVAILABLE", "a newer approved revision must not silently replace distributed audio");
    const localAId = (await distribute(localA.id, [facilities[0].id]))[facilities[0].id];
    const localCId = (await distribute(localC.id, [facilities[2].id]))[facilities[2].id];
    const allSource = await approvedProgramme(0, "All-facility C7 programme", 330);
    const allDistribution = await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: { programmeId: allSource.id, allFacilities: true } });
    assert.equal(allDistribution.status, 201, JSON.stringify(allDistribution.body));
    assert.deepEqual(allDistribution.body.targetFacilityIds, facilities.map((item) => item.id).sort());
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: manager.cookie,
      body: { programmeId: allSource.id, allFacilities: true } })).status, 403,
      "a facility manager cannot claim all-facilities authority without a network distribution grant");
    const weekday = localDateTimeParts(new Date(), "Europe/Malta").weekday;
    async function createWindow(facilityIndex, kind, distributionId) {
      const response = await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
        body: { facilityId: facilities[facilityIndex].id, kind, distributionId, weekday,
          startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"] } });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.window.id;
    }
    for (let index = 0; index < 3; index += 1) await createWindow(index, "CENTRAL", centralIds[facilities[index].id]);
    async function manifest(index) { return api("/api/player/manifest", { cookie: players[index].cookie, instanceId: players[index].instanceId }); }
    for (let index = 0; index < 3; index += 1) {
      const response = await manifest(index);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const insertion = response.body.insertions.find((item) => item.programmingSource === "CORRECTIONS_CENTRAL");
      assert.equal(insertion?.title, central.title);
      const mediaResponse = await fetch(new URL(insertion.mediaUrl, baseUrl), { headers: { cookie: players[index].cookie, range: "bytes=0-16043" } });
      assert.equal(mediaResponse.status, 206, `facility ${index} must fetch central audio through the private player route`);
      assert.ok(Math.abs(observedTone(Buffer.from(await mediaResponse.arrayBuffer())) - 440) < 5);
    }
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: facilities[1].id, kind: "LOCAL", distributionId: localAId, weekday,
        startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"] } })).status, 409);
    const localAWindow = await createWindow(0, "LOCAL", localAId);
    const localCWindow = await createWindow(2, "LOCAL", localCId);
    const during = await Promise.all([manifest(0), manifest(1), manifest(2)]);
    for (const [index, response] of during.entries()) {
      assert.equal(response.status, 200, `facility ${index} manifest: ${JSON.stringify(response.body)}`);
      assert.ok(Array.isArray(response.body.insertions), `facility ${index} must receive a manifest insertion list`);
    }
    assert.deepEqual(during.map((response) => response.body.insertions[0]?.programmingSource),
      ["CORRECTIONS_LOCAL", "CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL"]);
    assert.deepEqual(during.map((response) => response.body.insertions[0]?.title),
      [localA.title, central.title, localC.title]);
    const localASubmission = await db.correctionsSubmission.findFirst({ where: { programmeId: localA.id } });
    const localARender = await db.audioRender.findUnique({ where: { id: localASubmission.renderId } });
    await db.correctionsFacility.update({ where: { locationId: facilities[0].id },
      data: { blockedTrackIds: [localARender.outputMediaAssetId] } });
    assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "a receiving facility restriction must disqualify its local window at player resolution");
    assert.equal((await manifest(2)).body.insertions[0]?.programmingSource, "CORRECTIONS_LOCAL",
      "facility A restrictions must not affect facility C");
    await db.correctionsFacility.update({ where: { locationId: facilities[0].id }, data: { blockedTrackIds: [] } });
    await db.correctionsProfile.update({ where: { organisationId: authority.id },
      data: { blockedTrackIds: [localARender.outputMediaAssetId] } });
    assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "a facility cannot loosen the authority-wide prohibition");
    await db.correctionsProfile.update({ where: { organisationId: authority.id }, data: { blockedTrackIds: [] } });
    assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_LOCAL");
    for (const [index, expectedFrequency] of [[0, 880], [2, 220]]) {
      const mediaResponse = await fetch(new URL(during[index].body.insertions[0].mediaUrl, baseUrl),
        { headers: { cookie: players[index].cookie, range: "bytes=0-16043" } });
      assert.equal(mediaResponse.status, 206, `facility ${index} must fetch only its approved local audio`);
      assert.ok(Math.abs(observedTone(Buffer.from(await mediaResponse.arrayBuffer())) - expectedFrequency) < 5);
    }
    // C6 is above C7 even while a local window is active. Clearing an
    // override must re-resolve the current private plan, not a stale fallback.
    const centralRender = await db.audioRender.findUnique({ where: { id: firstCentralSubmission.renderId } });
    const alert = await db.correctionsAnnouncement.create({ data: { organisationId: authority.id,
      facilityId: facilities[0].id, title: "Synthetic facility A alert", mediaAssetId: centralRender.outputMediaAssetId,
      promoVersionId: centralRender.outputPromoVersionId, status: "APPROVED", createdByUserId: owner.user.id,
      approvedByUserId: manager.user.id, approvedAt: new Date() } });
    await db.correctionsFacility.update({ where: { locationId: facilities[0].id }, data: { priorityEnabled: true,
      emergencyEnabled: true } });
    await db.correctionsFacilityGrant.update({ where: { organisationMemberId_facilityId: {
      organisationMemberId: manager.membership.id, facilityId: facilities[0].id } }, data: {
      canPriorityActivate: true, canPriorityStop: true, canEmergencyActivate: true, canEmergencyClear: true } });
    for (const type of ["PRIORITY", "EMERGENCY"]) {
      const beforeInterruption = await manifest(0);
      assert.equal(beforeInterruption.status, 200);
      const interruptedLocal = beforeInterruption.body.insertions[0];
      assert.equal(interruptedLocal.programmingSource, "CORRECTIONS_LOCAL");
      const started = await api("/api/corrections/overrides", { method: "POST", cookie: manager.cookie,
        body: { facilityId: facilities[0].id, type, category: type === "EMERGENCY" ? "EMERGENCY_INSTRUCTION" : "OPERATIONAL_INFORMATION",
          announcementId: alert.id, zoneIds: [zones[0].id], idempotencyKey: randomUUID(),
          ...(type === "EMERGENCY" ? { confirmation: "START EMERGENCY" } : {}) } });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      const interrupted = await Promise.all([manifest(0), manifest(1), manifest(2)]);
      assert.deepEqual(interrupted.map((response) => response.body.insertions[0]?.programmingSource),
        [`CORRECTIONS_${type}`, "CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL"]);
      const interruptionProof = await api("/api/player/proof-of-play", { method: "POST", cookie: players[0].cookie,
        instanceId: players[0].instanceId, body: { events: [{ eventId: randomUUID(), manifestVersion: beforeInterruption.body.version,
          proofToken: interruptedLocal.proofToken, programmingSourceProofToken: interruptedLocal.programmingSourceProofToken,
          scheduleItemId: interruptedLocal.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_LOCAL",
          eventType: "INTERRUPTED", occurredAt: new Date().toISOString(), positionSeconds: 1 }] } });
      assert.equal(interruptionProof.status, 200, JSON.stringify(interruptionProof.body));
      assert.equal(interruptionProof.body.accepted, 1, "the interrupted local play is recorded without a completion claim");
      const falseCompletion = await api("/api/player/proof-of-play", { method: "POST", cookie: players[0].cookie,
        instanceId: players[0].instanceId, body: { events: [{ eventId: randomUUID(), manifestVersion: beforeInterruption.body.version,
          proofToken: interruptedLocal.proofToken, programmingSourceProofToken: interruptedLocal.programmingSourceProofToken,
          scheduleItemId: interruptedLocal.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_LOCAL",
          eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 }] } });
      assert.equal(falseCompletion.status, 400, "a displaced local intent cannot later claim completion");
      assert.equal(await db.proofOfPlayEvent.count({ where: { scheduleItemId: interruptedLocal.scheduleItemId,
        eventType: "COMPLETED" } }), 0, "C6 must not turn an interrupted local programme into delivered evidence");
      const cleared = await api(`/api/corrections/overrides/${started.body.override.id}/clear`, { method: "POST", cookie: manager.cookie });
      assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
      assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_LOCAL",
        "the current valid local window resumes after the facility override");
    }
    const facilityAMedia = new URL(during[0].body.insertions[0].mediaUrl, baseUrl);
    const facilityCMedia = new URL(during[2].body.insertions[0].mediaUrl, baseUrl);
    const facilityBListener = new URL(during[1].body.insertions[0].mediaUrl, baseUrl).search;
    assert.equal((await fetch(`${baseUrl}${facilityAMedia.pathname}${facilityBListener}`,
      { headers: { cookie: players[1].cookie } })).status, 404, "B cannot fetch A local audio with its own valid listener token");
    assert.equal((await fetch(`${baseUrl}${facilityCMedia.pathname}${facilityAMedia.search}`,
      { headers: { cookie: players[0].cookie } })).status, 404, "A cannot fetch C local audio");
    const resumedLocal = await manifest(0);
    assert.equal(resumedLocal.status, 200, JSON.stringify(resumedLocal.body));
    const localInsertion = resumedLocal.body.insertions[0];
    assert.equal(localInsertion?.programmingSource, "CORRECTIONS_LOCAL");
    const localProof = await api("/api/player/proof-of-play", { method: "POST", cookie: players[0].cookie, instanceId: players[0].instanceId,
      body: { events: [{ eventId: randomUUID(), manifestVersion: resumedLocal.body.version,
        proofToken: localInsertion.proofToken, programmingSourceProofToken: localInsertion.programmingSourceProofToken,
        scheduleItemId: localInsertion.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_LOCAL",
        eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 }] } });
    assert.equal(localProof.status, 200, JSON.stringify(localProof.body));
    assert.equal(localProof.body.accepted, 1);
    const afterProofMetrics = await api("/api/corrections/network", { cookie: owner.cookie });
    assert.equal(afterProofMetrics.status, 200);
    assert.equal(afterProofMetrics.body.deliveryMetricsLast7Days.localProgramme, 1);
    assert.equal(afterProofMetrics.body.deliveryMetricsLast7Days.centralProgramme, 0,
      "a fetched tone without signed completion is not central delivery evidence");
    const report = await fetch(`${baseUrl}/api/corrections/network/report/export?facilityId=${facilities[0].id}&source=CORRECTIONS_LOCAL&status=COMPLETED`,
      { headers: { cookie: owner.cookie } });
    assert.equal(report.status, 200);
    const csv = await report.text();
    assert.match(csv, /LOCAL,PROGRAMME,CORRECTIONS_LOCAL,COMPLETED/);
    const recordedProof = await db.proofOfPlayEvent.findFirst({ where: { organisationId: authority.id, playerId: players[0].player.id,
      programmingSource: "CORRECTIONS_LOCAL", eventType: "COMPLETED" }, select: { id: true, playoutIntentId: true } });
    assert.ok(recordedProof);
    assert.ok(csv.includes(recordedProof.id) && csv.includes(recordedProof.playoutIntentId), "export preserves source proof references");
    assert.ok(!csv.includes("Synthetic facility B") && !csv.includes("Synthetic facility C") && !csv.includes("contributor"));
    const noCentral = await fetch(`${baseUrl}/api/corrections/network/report/export?facilityId=${facilities[0].id}&classification=CENTRAL&kind=PROGRAMME&status=COMPLETED`,
      { headers: { cookie: owner.cookie } });
    assert.equal(noCentral.status, 200);
    assert.ok(!(await noCentral.text()).includes(recordedProof.id), "central filter excludes local proof");
    const exactProgramme = await fetch(`${baseUrl}/api/corrections/network/report/export?kind=PROGRAMME&programmeId=${localA.id}`, { headers: { cookie: owner.cookie } });
    assert.equal(exactProgramme.status, 200);
    assert.ok((await exactProgramme.text()).includes(recordedProof.id));
    const otherOrganisation = await fetch(`${baseUrl}/api/corrections/network/report/export?programmeId=${localA.id}`, { headers: { cookie: otherOwner.cookie } });
    assert.equal(otherOrganisation.status, 200);
    assert.ok(!(await otherOrganisation.text()).includes(recordedProof.id), "another authority cannot export this proof");
    const withdrawn = await api(`/api/corrections/network/distribution/${localAId}`, { method: "DELETE", cookie: owner.cookie });
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    const cancelledLocal = await db.playoutIntent.findFirst({ where: { id: recordedProof.playoutIntentId,
      playerId: players[0].player.id, sourceRevision: { startsWith: `c7:${localAWindow}:${localAId}:` } }, select: { id: true, cancelledAt: true } });
    assert.ok(cancelledLocal?.cancelledAt, "withdrawal cancels the issued local intent");
    assert.equal(await db.proofOfPlayEvent.count({ where: { playoutIntentId: cancelledLocal.id, eventType: "COMPLETED" } }), 1,
      "withdrawal preserves historical signed delivery evidence");
    const afterWithdrawalExport = await fetch(`${baseUrl}/api/corrections/network/report/export?facilityId=${facilities[0].id}&kind=PROGRAMME&status=COMPLETED`,
      { headers: { cookie: owner.cookie } });
    assert.ok((await afterWithdrawalExport.text()).includes(recordedProof.id), "withdrawal preserves exportable historical proof");
    const afterWithdrawal = await Promise.all([manifest(0), manifest(1), manifest(2)]);
    assert.deepEqual(afterWithdrawal.map((response) => response.body.insertions[0]?.programmingSource),
      ["CORRECTIONS_CENTRAL", "CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL"]);
    await api(`/api/corrections/network/windows/${localCWindow}`, { method: "DELETE", cookie: owner.cookie });
    for (let index = 0; index < 3; index += 1) assert.equal((await manifest(index)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL");
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: facilities[0].id, kind: "LOCAL", distributionId: localAId, weekday,
        startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"] } })).status, 409);

    // C7.3B uses the same private manifest/proof path for centrally reviewed
    // rehabilitation and STANDARD announcement audio. Group A+B never reaches C.
    const rehabProgramme = await approvedProgramme(0, "C7 rehabilitation source", 550);
    const rehabSubmission = await db.correctionsSubmission.findFirst({ where: { programmeId: rehabProgramme.id } });
    const rehabRender = await db.audioRender.findUnique({ where: { id: rehabSubmission.renderId } });
    const rehabCategory = await db.correctionsRehabCategory.create({ data: { organisationId: authority.id,
      code: `LEARNING_${suffix.toUpperCase()}`, name: "Learning" } });
    const rehab = await db.correctionsRehabContent.create({ data: { organisationId: authority.id, categoryId: rehabCategory.id,
      mediaAssetId: rehabRender.outputMediaAssetId, title: "Private learning module", providerName: "C7 test",
      status: "APPROVED", createdByUserId: owner.user.id, reviewedByUserId: manager.user.id,
      reviewedAt: new Date() } });
    assert.equal((await api("/api/corrections/network/audio-distribution", { method: "POST", cookie: owner.cookie,
      body: { kind: "REHABILITATION", contentId: rehab.id, facilityIds: [facilities[0].id], territoryCode: "MT" } })).status, 409,
      "network rehabilitation requires explicit rights confirmation");
    assert.equal((await api("/api/corrections/network/audio-distribution", { method: "POST", cookie: owner.cookie,
      body: { kind: "REHABILITATION", contentId: rehab.id, facilityIds: [foreign.id], territoryCode: "MT", rightsConfirmed: true } })).status, 400,
      "a raw foreign facility ID cannot become a distribution target");
    assert.equal((await api("/api/corrections/network/audio-distribution", { method: "POST", cookie: contributor.cookie,
      body: { kind: "REHABILITATION", contentId: rehab.id, allFacilities: true, territoryCode: "MT", rightsConfirmed: true } })).status, 403);
    const rehabDistribution = await api("/api/corrections/network/audio-distribution", { method: "POST", cookie: owner.cookie,
      body: { kind: "REHABILITATION", contentId: rehab.id, groupId: group.id, territoryCode: "MT", rightsConfirmed: true } });
    assert.equal(rehabDistribution.status, 201, JSON.stringify(rehabDistribution.body));
    assert.deepEqual(rehabDistribution.body.targetFacilityIds, [facilities[0].id, facilities[1].id].sort());
    assert.equal((await api("/api/corrections/network/audio-distribution", { method: "POST", cookie: manager.cookie,
      body: { kind: "REHABILITATION", contentId: rehab.id, allFacilities: true, territoryCode: "MT", rightsConfirmed: true } })).status, 403);
    const rehabIds = Object.fromEntries(rehabDistribution.body.targetFacilityIds.map((id, index) => [id, rehabDistribution.body.distributionIds[index]]));
    assert.equal((await api(`/api/corrections/network/audio-distribution/${rehabIds[facilities[1].id]}`,
      { method: "DELETE", cookie: manager.cookie })).status, 403,
      "facility A staff cannot withdraw the central distribution assigned to facility B");
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: facilities[2].id, kind: "CENTRAL", audioDistributionId: rehabIds[facilities[0].id],
        weekday, startMinute: 0, endMinute: 1440, mandatory: true, allowedContentTypes: ["REHABILITATION"] } })).status, 409);
    async function audioWindow(index, distributionId, contentType) {
      const response = await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
        body: { facilityId: facilities[index].id, kind: "CENTRAL", audioDistributionId: distributionId,
          weekday, startMinute: 0, endMinute: 1440, mandatory: true, allowedContentTypes: [contentType] } });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.id;
    }
    await audioWindow(0, rehabIds[facilities[0].id], "REHABILITATION");
    await audioWindow(1, rehabIds[facilities[1].id], "REHABILITATION");
    const rehabManifests = await Promise.all([manifest(0), manifest(1), manifest(2)]);
    for (const response of rehabManifests) assert.equal(response.status, 200, JSON.stringify(response.body));
    for (const response of rehabManifests) assert.ok(Array.isArray(response.body.insertions), JSON.stringify(response.body));
    assert.deepEqual(rehabManifests.map((response) => response.body.insertions[0]?.programmingSource),
      ["CORRECTIONS_CENTRAL_REHAB", "CORRECTIONS_CENTRAL_REHAB", "CORRECTIONS_CENTRAL"]);
    const rehabInsertion = rehabManifests[0].body.insertions[0];
    const rehabMedia = await fetch(new URL(rehabInsertion.mediaUrl, baseUrl), { headers: {
      cookie: players[0].cookie, range: "bytes=0-16043" } });
    assert.equal(rehabMedia.status, 206);
    assert.ok(Math.abs(observedTone(Buffer.from(await rehabMedia.arrayBuffer())) - 550) < 5);
    const rehabProof = await api("/api/player/proof-of-play", { method: "POST", cookie: players[0].cookie,
      instanceId: players[0].instanceId, body: { events: [{ eventId: randomUUID(), manifestVersion: rehabManifests[0].body.version,
        proofToken: rehabInsertion.proofToken, programmingSourceProofToken: rehabInsertion.programmingSourceProofToken,
        scheduleItemId: rehabInsertion.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_CENTRAL_REHAB",
        eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 }] } });
    assert.equal(rehabProof.status, 200, JSON.stringify(rehabProof.body));
    assert.equal(rehabProof.body.accepted, 1);
    assert.equal((await api("/api/corrections/network", { cookie: owner.cookie })).body.deliveryMetricsLast7Days.centralRehabilitation, 1);
    const rehabCsv = await fetch(`${baseUrl}/api/corrections/network/report/export?groupId=${group.id}&kind=REHABILITATION&source=CORRECTIONS_CENTRAL_REHAB`,
      { headers: { cookie: owner.cookie } });
    assert.equal(rehabCsv.status, 200);
    assert.match(await rehabCsv.text(), /CENTRAL,REHABILITATION,CORRECTIONS_CENTRAL_REHAB,COMPLETED/);
    const withdrawnRehab = await api(`/api/corrections/network/audio-distribution/${rehabIds[facilities[0].id]}`,
      { method: "DELETE", cookie: owner.cookie });
    assert.equal(withdrawnRehab.status, 200, JSON.stringify(withdrawnRehab.body));
    assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "withdrawal returns facility A to its valid central default");
    assert.equal((await manifest(1)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL_REHAB");
    await api(`/api/corrections/network/audio-distribution/${rehabIds[facilities[1].id]}`,
      { method: "DELETE", cookie: owner.cookie });
    assert.equal((await manifest(1)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL");
    assert.match(await (await fetch(`${baseUrl}/api/corrections/network/report/export?kind=REHABILITATION`,
      { headers: { cookie: owner.cookie } })).text(), /CORRECTIONS_CENTRAL_REHAB,COMPLETED/,
      "withdrawal retains historical signed rehabilitation evidence");

    const announcementProgramme = await approvedProgramme(0, "C7 standard announcement source", 770);
    const announcementSubmission = await db.correctionsSubmission.findFirst({ where: { programmeId: announcementProgramme.id } });
    const announcementRender = await db.audioRender.findUnique({ where: { id: announcementSubmission.renderId } });
    const standard = await db.correctionsAnnouncement.create({ data: { organisationId: authority.id,
      facilityId: facilities[0].id, title: "Central standard information", mediaAssetId: announcementRender.outputMediaAssetId,
      promoVersionId: announcementRender.outputPromoVersionId, status: "APPROVED", createdByUserId: owner.user.id,
      approvedByUserId: manager.user.id, approvedAt: new Date() } });
    const announcementDistribution = await api("/api/corrections/network/audio-distribution", { method: "POST", cookie: owner.cookie,
      body: { kind: "ANNOUNCEMENT", contentId: standard.id, groupId: group.id, rightsConfirmed: true } });
    assert.equal(announcementDistribution.status, 201, JSON.stringify(announcementDistribution.body));
    const announcementIds = Object.fromEntries(announcementDistribution.body.targetFacilityIds.map((id, index) => [id, announcementDistribution.body.distributionIds[index]]));
    await audioWindow(0, announcementIds[facilities[0].id], "ANNOUNCEMENT");
    await audioWindow(1, announcementIds[facilities[1].id], "ANNOUNCEMENT");
    const announcementManifests = await Promise.all([manifest(0), manifest(1), manifest(2)]);
    for (const response of announcementManifests) assert.equal(response.status, 200, JSON.stringify(response.body));
    for (const response of announcementManifests) assert.ok(Array.isArray(response.body.insertions), JSON.stringify(response.body));
    assert.deepEqual(announcementManifests.map((response) => response.body.insertions[0]?.programmingSource),
      ["CORRECTIONS_CENTRAL_ANNOUNCE", "CORRECTIONS_CENTRAL_ANNOUNCE", "CORRECTIONS_CENTRAL"]);
    const announcementInsertion = announcementManifests[1].body.insertions[0];
    const announcementMedia = await fetch(new URL(announcementInsertion.mediaUrl, baseUrl), { headers: {
      cookie: players[1].cookie, range: "bytes=0-16043" } });
    assert.equal(announcementMedia.status, 206);
    assert.ok(Math.abs(observedTone(Buffer.from(await announcementMedia.arrayBuffer())) - 770) < 5);
    const announcementProof = await api("/api/player/proof-of-play", { method: "POST", cookie: players[1].cookie,
      instanceId: players[1].instanceId, body: { events: [{ eventId: randomUUID(), manifestVersion: announcementManifests[1].body.version,
        proofToken: announcementInsertion.proofToken, programmingSourceProofToken: announcementInsertion.programmingSourceProofToken,
        scheduleItemId: announcementInsertion.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_CENTRAL_ANNOUNCE",
        eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 }] } });
    assert.equal(announcementProof.status, 200, JSON.stringify(announcementProof.body));
    assert.equal(announcementProof.body.accepted, 1);
    assert.equal((await api("/api/corrections/network", { cookie: owner.cookie })).body.deliveryMetricsLast7Days.centralAnnouncement, 1);
    const announcementCsv = await fetch(`${baseUrl}/api/corrections/network/report/export?groupId=${group.id}&kind=ANNOUNCEMENT&source=CORRECTIONS_CENTRAL_ANNOUNCE`,
      { headers: { cookie: owner.cookie } });
    assert.equal(announcementCsv.status, 200);
    assert.match(await announcementCsv.text(), /CENTRAL,ANNOUNCEMENT,CORRECTIONS_CENTRAL_ANNOUNCE,COMPLETED/);
    await db.correctionsFacility.update({ where: { locationId: facilities[0].id }, data: {
      blockedTrackIds: [announcementRender.outputMediaAssetId] } });
    assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "facility A can tighten policy while unaffected B retains its central announcement");
    assert.equal((await manifest(1)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL_ANNOUNCE");
    await db.correctionsFacility.update({ where: { locationId: facilities[0].id }, data: { blockedTrackIds: [] } });
    await db.correctionsProfile.update({ where: { organisationId: authority.id }, data: {
      blockedTrackIds: [announcementRender.outputMediaAssetId] } });
    assert.equal((await manifest(1)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "central policy cannot be weakened by the receiving facility");
    await db.correctionsProfile.update({ where: { organisationId: authority.id }, data: { blockedTrackIds: [] } });
    await api(`/api/corrections/network/audio-distribution/${announcementIds[facilities[0].id]}`,
      { method: "DELETE", cookie: owner.cookie });
    await api(`/api/corrections/network/audio-distribution/${announcementIds[facilities[1].id]}`,
      { method: "DELETE", cookie: owner.cookie });
    assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL");
    assert.equal((await manifest(1)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL");

    const facilityOfferProgramme = await approvedProgramme(0, "Facility-made syndicated programme", 990, manager.user.id);
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: { programmeId: facilityOfferProgramme.id, facilityIds: [facilities[1].id] } })).status, 409,
      "a raw facility programme ID cannot bypass central syndication acceptance");
    assert.equal((await api("/api/corrections/network/syndication", { method: "POST", cookie: contributor.cookie,
      body: { programmeId: facilityOfferProgramme.id } })).status, 403);
    const offered = await api("/api/corrections/network/syndication", { method: "POST", cookie: manager.cookie,
      body: { programmeId: facilityOfferProgramme.id } });
    assert.equal(offered.status, 201, JSON.stringify(offered.body));
    assert.equal((await api("/api/corrections/network/syndication", { cookie: contributor.cookie })).status, 403);
    const radioExchange = await api("/api/radio-syndication", { cookie: owner.cookie });
    assert.ok(!JSON.stringify(radioExchange.body).includes(facilityOfferProgramme.title),
      "a private Inside offer never appears in Online Radio syndication");
    const schoolExchange = await api("/api/school-radio/network/exchange", { cookie: owner.cookie });
    assert.ok(!JSON.stringify(schoolExchange.body).includes(facilityOfferProgramme.title),
      "a private Inside offer never appears in School exchange");
    assert.equal((await api(`/api/corrections/network/syndication/${offered.body.id}`, { method: "PATCH",
      cookie: manager.cookie, body: { decision: "ACCEPTED" } })).status, 403,
      "the offering facility staff cannot accept its own offer");
    assert.equal((await api(`/api/corrections/network/syndication/${offered.body.id}`, { method: "PATCH",
      cookie: owner.cookie, body: { decision: "ACCEPTED" } })).status, 200);
    const syndicated = await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: { programmeId: facilityOfferProgramme.id, syndicationOfferId: offered.body.id,
        facilityIds: [facilities[1].id] } });
    assert.equal(syndicated.status, 201, JSON.stringify(syndicated.body));
    const syndicatedWindow = await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: facilities[1].id, kind: "CENTRAL", distributionId: syndicated.body.distributionIds[0],
        weekday, startMinute: 0, endMinute: 1440, mandatory: true, allowedContentTypes: ["PROGRAMME"] } });
    assert.equal(syndicatedWindow.status, 201, JSON.stringify(syndicatedWindow.body));
    const syndicationManifest = await manifest(1);
    assert.equal(syndicationManifest.status, 200, JSON.stringify(syndicationManifest.body));
    assert.equal(syndicationManifest.body.insertions[0]?.programmingSource, "CORRECTIONS_SYNDICATED");
    assert.equal((await manifest(2)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "an unselected facility never receives private syndication");
    const syndicatedItem = syndicationManifest.body.insertions[0];
    const syndicatedProof = await api("/api/player/proof-of-play", { method: "POST", cookie: players[1].cookie,
      instanceId: players[1].instanceId, body: { events: [{ eventId: randomUUID(), manifestVersion: syndicationManifest.body.version,
        proofToken: syndicatedItem.proofToken, programmingSourceProofToken: syndicatedItem.programmingSourceProofToken,
        scheduleItemId: syndicatedItem.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_SYNDICATED",
        eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 }] } });
    assert.equal(syndicatedProof.status, 200, JSON.stringify(syndicatedProof.body));
    assert.equal(syndicatedProof.body.accepted, 1);
    assert.equal((await api("/api/corrections/network", { cookie: owner.cookie })).body.deliveryMetricsLast7Days.syndicatedProgramme, 1);
    const syndicationCsv = await fetch(`${baseUrl}/api/corrections/network/report/export?classification=SYNDICATED&kind=PROGRAMME`,
      { headers: { cookie: owner.cookie } });
    assert.equal(syndicationCsv.status, 200);
    assert.match(await syndicationCsv.text(), /SYNDICATED,PROGRAMME,CORRECTIONS_SYNDICATED,COMPLETED/);
    const withdrawnOffer = await api(`/api/corrections/network/syndication/${offered.body.id}`, { method: "PATCH",
      cookie: owner.cookie, body: { decision: "WITHDRAWN" } });
    assert.equal(withdrawnOffer.status, 200, JSON.stringify(withdrawnOffer.body));
    assert.equal((await manifest(1)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "withdrawing an accepted offer cancels future private playback and returns to central default");
    assert.match(await (await fetch(`${baseUrl}/api/corrections/network/report/export?classification=SYNDICATED`,
      { headers: { cookie: owner.cookie } })).text(), /CORRECTIONS_SYNDICATED,COMPLETED/,
      "historical evidence survives syndication withdrawal");

    // A separately approved, version-pinned private programme is the last
    // resort. It must never borrow the ordinary public AutoDJ path.
    const fallbackProgramme = await approvedProgramme(0, "Private fallback programme", 120);
    const fallbackId = (await distribute(fallbackProgramme.id, [facilities[0].id]))[facilities[0].id];
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: manager.cookie,
      body: { facilityId: facilities[0].id, kind: "FALLBACK", distributionId: fallbackId,
        weekday, startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"] } })).status, 403,
      "a facility-only manager cannot configure network fallback authority");
    const fallbackWindow = await createWindow(0, "FALLBACK", fallbackId);
    assert.equal((await manifest(0)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "an approved fallback never replaces valid central programming");
    assert.equal((await api(`/api/corrections/network/distribution/${centralIds[facilities[0].id]}`,
      { method: "DELETE", cookie: owner.cookie })).status, 200);
    const fallbackManifest = await manifest(0);
    assert.equal(fallbackManifest.body.insertions[0]?.programmingSource, "CORRECTIONS_FALLBACK",
      "withdrawal must resolve the approved private fallback, not public audio or silence");
    assert.equal(fallbackManifest.body.programmingAlert?.code, "CORRECTIONS_PRIVATE_FALLBACK");
    assert.equal((await manifest(1)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL",
      "unaffected facilities retain their own current programme");
    const fallbackItem = fallbackManifest.body.insertions[0];
    const fallbackMedia = await fetch(new URL(fallbackItem.mediaUrl, baseUrl), { headers: {
      cookie: players[0].cookie, range: "bytes=0-16043" } });
    assert.equal(fallbackMedia.status, 206);
    assert.ok(Math.abs(observedTone(Buffer.from(await fallbackMedia.arrayBuffer())) - 120) < 5);
    const fallbackProof = await api("/api/player/proof-of-play", { method: "POST", cookie: players[0].cookie,
      instanceId: players[0].instanceId, body: { events: [{ eventId: randomUUID(), manifestVersion: fallbackManifest.body.version,
        proofToken: fallbackItem.proofToken, programmingSourceProofToken: fallbackItem.programmingSourceProofToken,
        scheduleItemId: fallbackItem.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_FALLBACK",
        eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 }] } });
    assert.equal(fallbackProof.status, 200, JSON.stringify(fallbackProof.body));
    assert.equal(fallbackProof.body.accepted, 1);
    assert.equal((await api("/api/corrections/network", { cookie: owner.cookie })).body.deliveryMetricsLast7Days.fallbackProgramme, 1);
    const fallbackCsv = await fetch(`${baseUrl}/api/corrections/network/report/export?facilityId=${facilities[0].id}&source=CORRECTIONS_FALLBACK`,
      { headers: { cookie: owner.cookie } });
    assert.equal(fallbackCsv.status, 200);
    assert.match(await fallbackCsv.text(), /CENTRAL,PROGRAMME,CORRECTIONS_FALLBACK,COMPLETED/);
    assert.equal((await api(`/api/corrections/network/windows/${fallbackWindow}`, { method: "DELETE", cookie: owner.cookie })).status, 200);
    const noApprovedSource = await manifest(0);
    assert.equal(noApprovedSource.body.insertions.length, 0, "private playback fails closed if every approved source is removed");
    assert.equal(noApprovedSource.body.programmingAlert?.code, "CORRECTIONS_NO_APPROVED_SOURCE");

    await db.player.update({ where: { id: players[1].player.id }, data: { status: "OFFLINE", lastHeartbeatAt: new Date(Date.now() - 180_000) } });
    const degraded = await api("/api/corrections/network", { cookie: owner.cookie });
    assert.equal(degraded.status, 200);
    assert.equal(degraded.body.facilities.find((item) => item.id === facilities[1].id)?.offlinePlayers, 1);
    assert.equal(degraded.body.deliveryMetricsLast7Days.centralProgramme, 0,
      "an offline facility with no completed proof is never counted delivered");

    await db.plan.update({ where: { id: plan.id }, data: { tierNumber: 3 } });
    assert.equal((await api("/api/corrections/network", { cookie: owner.cookie })).status, 403);
    assert.equal((await api("/api/corrections/network/audio-distribution", { method: "POST", cookie: owner.cookie,
      body: { kind: "REHABILITATION", contentId: rehab.id, allFacilities: true, territoryCode: "MT", rightsConfirmed: true } })).status, 403);
    assert.equal((await api("/api/corrections/network/syndication", { cookie: owner.cookie })).status, 403);
    assert.equal((await api("/api/corrections/network/syndication", { method: "POST", cookie: manager.cookie,
      body: { programmeId: facilityOfferProgramme.id } })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/corrections/network/report/export`, { headers: { cookie: owner.cookie } })).status, 403);
    assert.equal((await api("/api/corrections/network", { cookie: manager.cookie })).status, 403);
  } finally {
    if (mediaStore.listening) await new Promise((resolve) => mediaStore.close(resolve));
    if (authority) {
      await db.rightsUsageLedgerEvent.deleteMany({ where: { organisationId: authority.id } });
      await db.proofOfPlayEvent.deleteMany({ where: { organisationId: authority.id } });
      await db.playoutIntent.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsOverride.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsNetworkWindow.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsNetworkAudioDistribution.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsProgrammeDistribution.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsSyndicationOffer.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsAnnouncement.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsRehabProgrammeItem.deleteMany({ where: { programme: { organisationId: authority.id } } });
      await db.correctionsRehabContent.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsRehabCategory.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsReview.deleteMany({ where: { submission: { organisationId: authority.id } } });
      await db.correctionsSubmission.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsProgramme.deleteMany({ where: { organisationId: authority.id } });
      await db.audioTake.deleteMany({ where: { organisationId: authority.id } });
      await db.audioRender.deleteMany({ where: { organisationId: authority.id } });
      await db.audioProjectVersion.deleteMany({ where: { project: { organisationId: authority.id } } });
      await db.audioProject.deleteMany({ where: { organisationId: authority.id } });
      await db.promoAsset.updateMany({ where: { organisationId: authority.id }, data: { currentApprovedVersionId: null } });
      await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId: authority.id } } });
      await db.promoAsset.deleteMany({ where: { organisationId: authority.id } });
      await db.mediaAsset.deleteMany({ where: { organisationId: authority.id } });
      await db.playerListenerLease.deleteMany({ where: { organisationId: authority.id } });
      await db.player.deleteMany({ where: { organisationId: authority.id } });
      await db.channelAssignment.deleteMany({ where: { channel: { organisationId: authority.id } } });
      await db.channel.deleteMany({ where: { organisationId: authority.id } });
      await db.station.deleteMany({ where: { organisationId: authority.id } });
      await db.auditLog.deleteMany({ where: { organisationId: authority.id } });
      await db.organisation.delete({ where: { id: authority.id } });
    }
    if (outsider) await db.organisation.delete({ where: { id: outsider.id } });
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});
