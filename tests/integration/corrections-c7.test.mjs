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
    assert.match(await emptyReport.text(), /^date,facility,source,status,playerEvents\r\n$/);
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
    async function approvedProgramme(facilityIndex, label, frequency) {
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
        title: label, createdByUserId: owner.user.id, status: "APPROVED", latestRevision: 1 } });
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
    async function distribute(programmeId, facilityIds) {
      const response = await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie, body: { programmeId, facilityIds } });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return Object.fromEntries(response.body.targetFacilityIds.map((id, index) => [id, response.body.distributionIds[index]]));
    }
    const centralIds = await distribute(central.id, facilities.map((facility) => facility.id));
    const localAId = (await distribute(localA.id, [facilities[0].id]))[facilities[0].id];
    const localCId = (await distribute(localC.id, [facilities[2].id]))[facilities[2].id];
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
    assert.deepEqual(during.map((response) => response.body.insertions[0]?.programmingSource),
      ["CORRECTIONS_LOCAL", "CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL"]);
    assert.deepEqual(during.map((response) => response.body.insertions[0]?.title),
      [localA.title, central.title, localC.title]);
    for (const [index, expectedFrequency] of [[0, 880], [2, 220]]) {
      const mediaResponse = await fetch(new URL(during[index].body.insertions[0].mediaUrl, baseUrl),
        { headers: { cookie: players[index].cookie, range: "bytes=0-16043" } });
      assert.equal(mediaResponse.status, 206, `facility ${index} must fetch only its approved local audio`);
      assert.ok(Math.abs(observedTone(Buffer.from(await mediaResponse.arrayBuffer())) - expectedFrequency) < 5);
    }
    const localInsertion = during[0].body.insertions[0];
    const localProof = await api("/api/player/proof-of-play", { method: "POST", cookie: players[0].cookie, instanceId: players[0].instanceId,
      body: { events: [{ eventId: randomUUID(), manifestVersion: during[0].body.version,
        proofToken: localInsertion.proofToken, programmingSourceProofToken: localInsertion.programmingSourceProofToken,
        scheduleItemId: localInsertion.scheduleItemId, itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_LOCAL",
        eventType: "COMPLETED", occurredAt: new Date().toISOString(), positionSeconds: 30 }] } });
    assert.equal(localProof.status, 200, JSON.stringify(localProof.body));
    assert.equal(localProof.body.accepted, 1);
    const report = await fetch(`${baseUrl}/api/corrections/network/report/export?facilityId=${facilities[0].id}&source=CORRECTIONS_LOCAL&status=COMPLETED`,
      { headers: { cookie: owner.cookie } });
    assert.equal(report.status, 200);
    const csv = await report.text();
    assert.match(csv, /CORRECTIONS_LOCAL,COMPLETED,1/);
    assert.ok(!csv.includes("Synthetic facility B") && !csv.includes("Synthetic facility C") && !csv.includes("contributor"));
    const withdrawn = await api(`/api/corrections/network/distribution/${localAId}`, { method: "DELETE", cookie: owner.cookie });
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    const cancelledLocal = await db.playoutIntent.findFirst({ where: { playerId: players[0].player.id,
      sourceRevision: { startsWith: `c7:${localAWindow}:${localAId}:` } }, select: { id: true, cancelledAt: true } });
    assert.ok(cancelledLocal?.cancelledAt, "withdrawal cancels the issued local intent");
    assert.equal(await db.proofOfPlayEvent.count({ where: { playoutIntentId: cancelledLocal.id, eventType: "COMPLETED" } }), 1,
      "withdrawal preserves historical signed delivery evidence");
    const afterWithdrawal = await Promise.all([manifest(0), manifest(1), manifest(2)]);
    assert.deepEqual(afterWithdrawal.map((response) => response.body.insertions[0]?.programmingSource),
      ["CORRECTIONS_CENTRAL", "CORRECTIONS_CENTRAL", "CORRECTIONS_LOCAL"]);
    await api(`/api/corrections/network/windows/${localCWindow}`, { method: "DELETE", cookie: owner.cookie });
    for (let index = 0; index < 3; index += 1) assert.equal((await manifest(index)).body.insertions[0]?.programmingSource, "CORRECTIONS_CENTRAL");
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: facilities[0].id, kind: "LOCAL", distributionId: localAId, weekday,
        startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"] } })).status, 409);

    await db.plan.update({ where: { id: plan.id }, data: { tierNumber: 3 } });
    assert.equal((await api("/api/corrections/network", { cookie: owner.cookie })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/corrections/network/report/export`, { headers: { cookie: owner.cookie } })).status, 403);
    assert.equal((await api("/api/corrections/network", { cookie: manager.cookie })).status, 403);
  } finally {
    if (mediaStore.listening) await new Promise((resolve) => mediaStore.close(resolve));
    if (authority) {
      await db.rightsUsageLedgerEvent.deleteMany({ where: { organisationId: authority.id } });
      await db.proofOfPlayEvent.deleteMany({ where: { organisationId: authority.id } });
      await db.playoutIntent.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsNetworkWindow.deleteMany({ where: { organisationId: authority.id } });
      await db.correctionsProgrammeDistribution.deleteMany({ where: { organisationId: authority.id } });
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
