import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";
import { correctionsRenderEvidence } from "../../lib/corrections-workflow.mjs";
import { localDateTimeParts } from "../../lib/opening-hours.mjs";
import { verifyEdgeManifest } from "../../lib/corrections-edge-manifest.mjs";
import { verifyCorrectionsEdgePlayerGrant } from "../../lib/corrections-edge-player-grant.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3108";
const testPrivateKey = createPrivateKey({ key: Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)
]), format: "der", type: "pkcs8" });
const testPublicPem = createPublicKey(testPrivateKey).export({ type: "spki", format: "pem" });

async function api(path, { method = "GET", body, cookie, machine } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { origin: baseUrl,
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(cookie ? { cookie } : {}), ...(machine ? { authorization: `Bearer ${machine}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("C8B signed C7 manifest/media is exact, protected, facility-scoped and withdrawn on resync", async () => {
  if (process.env.C8_LOCAL_INTEGRATION !== "true" ||
      process.env.DATABASE_URL !== "postgresql://c8lab@127.0.0.1:5548/ruvanas_c8_migration_clean" ||
      !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C8 manifest integration is restricted to the exact isolated local test database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const password = `C8-manifest-${randomUUID()}!`;
  const mediaBytes = Buffer.from("synthetic, private C8 programme audio");
  const storageKey = `c8-${suffix}/programme.wav`;
  const mockR2 = createServer((request, response) => {
    if (request.method !== "GET" || new URL(request.url, "http://localhost").pathname !== `/c8-test/${storageKey}`) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": mediaBytes.length });
    response.end(mediaBytes);
  });
  let organisation, plan, media, promo, users = [];
  try {
    await new Promise((resolve, reject) => mockR2.once("error", reject).listen(9108, "127.0.0.1", resolve));
    plan = await db.plan.create({ data: { name: `C8 manifest ${suffix}`, code: `C8_MANIFEST_${suffix}`,
      productFamily: "CORRECTIONS", tierNumber: 4, monthlyPriceCents: 49900, storageLimitGb: 10,
      listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true, stationLimit: 4 } });
    organisation = await db.organisation.create({ data: { name: `C8 authority ${suffix}`, slug: `c8-authority-${suffix}` } });
    await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE" } });
    await db.correctionsProfile.create({ data: { organisationId: organisation.id, policyConfiguredAt: new Date() } });
    async function user(role, label) {
      const created = await db.user.create({ data: { name: label, email: `c8-${label}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 4), role } });
      users.push(created);
      const login = await api("/api/auth/login", { method: "POST", body: { email: created.email, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      return { user: created, cookie: login.cookie };
    }
    const admin = await user("SUPER_ADMIN", "admin-manifest");
    const owner = await user("OWNER", "owner-manifest");
    const manager = await user("MANAGER", "manager-manifest");
    const facilities = [];
    for (const label of ["A", "B"]) facilities.push(await db.location.create({ data: {
      organisationId: organisation.id, name: `C8 facility ${label}`, slug: `c8-${label}-${suffix}`,
      status: "ACTIVE", countryCode: "MT", timezone: "Europe/Malta",
      zones: { create: { name: "Wing 1", slug: "wing-1", status: "ACTIVE" } },
      correctionsFacility: { create: { policyConfiguredAt: new Date() } }
    }, include: { zones: true } }));
    const station = await db.station.create({ data: { organisationId: organisation.id, productFamily: "CORRECTIONS",
      name: "C8 private", slug: `c8-station-${suffix}`, status: "ACTIVE", listenerLimit: 10,
      storageLimitGb: 1, maxBitrateKbps: 128 } });
    const channel = await db.channel.create({ data: { organisationId: organisation.id, stationId: station.id,
      name: "C8 channel", slug: `c8-channel-${suffix}`, status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO" } });
    const players = [];
    for (const facility of facilities) {
      await db.channelAssignment.create({ data: { channelId: channel.id, zoneId: facility.zones[0].id,
        activeFrom: new Date(Date.now() - 60_000) } });
      const token = `c8-player-${randomUUID()}`;
      const player = await db.player.create({ data: { organisationId: organisation.id, zoneId: facility.zones[0].id,
        name: "Synthetic C8 player", status: "ONLINE", sessionTokenHash: hashPlayerToken(token, process.env.SESSION_SECRET),
        enrolledAt: new Date(), lastHeartbeatAt: new Date() } });
      players.push({ player, cookie: `ruvanas_player=${token}` });
    }
    media = await db.mediaAsset.create({ data: { organisationId: organisation.id, libraryType: "ORGANISATION_PROMO",
      name: "C8 approved programme", originalName: "synthetic.wav", storageKey, mimeType: "audio/wav",
      sizeBytes: BigInt(mediaBytes.length), durationSeconds: 30, mediaType: "ANNOUNCEMENT", status: "READY" } });
    promo = await db.promoAsset.create({ data: { organisationId: organisation.id, name: "C8 approved programme", mediaType: "ANNOUNCEMENT" } });
    const checksum = createHash("sha256").update(mediaBytes).digest("hex");
    const promoVersion = await db.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: media.id,
      version: 1, status: "APPROVED", qcStatus: "PASSED", checksumSha256: checksum } });
    await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: promoVersion.id } });
    const project = await db.audioProject.create({ data: { organisationId: organisation.id, title: "C8 programme",
      editDecision: {}, createdByUserId: owner.user.id } });
    const version = await db.audioProjectVersion.create({ data: { projectId: project.id, version: 1,
      state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: media.id }] } }, createdByUserId: owner.user.id } });
    await db.audioTake.create({ data: { organisationId: organisation.id, projectId: project.id, mediaAssetId: media.id,
      promoVersionId: promoVersion.id, recordedByUserId: owner.user.id, status: "READY", sourceEditDecision: {} } });
    const render = await db.audioRender.create({ data: { organisationId: organisation.id, projectId: project.id,
      versionId: version.id, outputMediaAssetId: media.id, outputPromoVersionId: promoVersion.id,
      requestedByUserId: owner.user.id, preset: "SPEECH_MP3", status: "SUCCEEDED", completedAt: new Date(),
      resultJson: { checksumSha256: checksum } } });
    const evidence = correctionsRenderEvidence(await db.audioRender.findUnique({ where: { id: render.id }, include: {
      outputMediaAsset: true, outputPromoVersion: true, version: { select: { state: true } },
      project: { select: { organisationId: true, createdByUserId: true, currentVersion: true, title: true } }
    } }));
    const programme = await db.correctionsProgramme.create({ data: { organisationId: organisation.id, facilityId: facilities[0].id,
      title: "C8 programme", createdByUserId: owner.user.id, networkOrigin: "CENTRAL", status: "APPROVED", latestRevision: 1 } });
    const submission = await db.correctionsSubmission.create({ data: { programmeId: programme.id, organisationId: organisation.id,
      facilityId: facilities[0].id, revision: 1, renderId: render.id, sourceFingerprint: evidence.fingerprint,
      organisationPolicyVersion: 1, facilityPolicyVersion: 1, titleSnapshot: "C8 programme", evidenceSnapshot: evidence,
      submittedByUserId: owner.user.id, status: "APPROVED" } });
    await db.correctionsReview.create({ data: { submissionId: submission.id, stage: "STAFF", decision: "APPROVE",
      note: "Synthetic C8 review", evidenceSnapshot: {}, reviewedByUserId: manager.user.id } });
    const distribution = await db.correctionsProgrammeDistribution.create({ data: { organisationId: organisation.id,
      sourceFacilityId: facilities[0].id, targetFacilityId: facilities[0].id, programmeId: programme.id,
      submissionId: submission.id, effectiveFrom: new Date(Date.now() - 60_000), createdByUserId: owner.user.id } });
    const window = await db.correctionsNetworkWindow.create({ data: { organisationId: organisation.id,
      facilityId: facilities[0].id, kind: "CENTRAL", distributionId: distribution.id,
      weekday: localDateTimeParts(new Date(), "Europe/Malta").weekday, startMinute: 0, endMinute: 1440,
      allowedContentTypes: ["PROGRAMME"], createdByUserId: owner.user.id } });
    async function edgeFor(facility) {
      const created = await api("/api/admin/corrections/edge", { method: "POST", cookie: admin.cookie,
        body: { organisationId: organisation.id, facilityId: facility.id, name: `Synthetic Edge ${facility.name}` } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const enrolled = await api("/api/corrections/edge/enrol", { method: "POST",
        body: { enrolmentCredential: created.body.enrolmentCredential } });
      assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
      return { id: created.body.nodeId, credential: enrolled.body.machineCredential };
    }
    const edgeA = await edgeFor(facilities[0]);
    const edgeB = await edgeFor(facilities[1]);
    const manifestA = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(manifestA.status, 200, JSON.stringify(manifestA.body));
    assert.equal(verifyEdgeManifest(manifestA.body, testPublicPem,
      { nodeId: edgeA.id, organisationId: organisation.id, facilityId: facilities[0].id }), true);
    assert.equal(manifestA.body.payload.content.length, 1);
    assert.equal(manifestA.body.payload.windows[0].sourceRevision,
      `c7:${window.id}:${distribution.id}:${submission.id}:${submission.sourceFingerprint}`);
    const manifestB = await api("/api/corrections/edge/manifest", { machine: edgeB.credential });
    assert.equal(manifestB.status, 200);
    assert.equal(manifestB.body.payload.content.length, 0);
    const grant = await api(`/api/player/edge-grant/${edgeA.id}`, { method: "POST", cookie: players[0].cookie });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.equal(verifyCorrectionsEdgePlayerGrant(grant.body, testPublicPem,
      { nodeId: edgeA.id, organisationId: organisation.id, facilityId: facilities[0].id }), true);
    assert.equal((await api(`/api/player/edge-grant/${edgeA.id}`, { method: "POST", cookie: players[1].cookie })).status, 404);
    assert.equal((await api(`/api/corrections/edge/media/${media.id}`, { machine: edgeB.credential })).status, 404);
    assert.equal((await api(`/api/corrections/edge/media/${randomUUID()}`, { machine: edgeA.credential })).status, 404);
    const protectedResponse = await fetch(`${baseUrl}/api/corrections/edge/media/${media.id}`,
      { headers: { authorization: `Bearer ${edgeA.credential}` } });
    assert.equal(protectedResponse.status, 200);
    assert.deepEqual(Buffer.from(await protectedResponse.arrayBuffer()), mediaBytes);
    await db.correctionsProgrammeDistribution.update({ where: { id: distribution.id }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
    await db.correctionsNetworkWindow.update({ where: { id: window.id }, data: { active: false } });
    const withdrawn = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.payload.content.length, 0);
    assert.equal((await api(`/api/corrections/edge/media/${media.id}`, { machine: edgeA.credential })).status, 404);
  } finally {
    if (mockR2.listening) await new Promise((resolve) => mockR2.close(resolve));
    if (organisation) {
      await db.correctionsEdgeNode.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsNetworkWindow.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsProgrammeDistribution.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsReview.deleteMany({ where: { submission: { organisationId: organisation.id } } });
      await db.correctionsSubmission.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsProgramme.deleteMany({ where: { organisationId: organisation.id } });
      await db.audioTake.deleteMany({ where: { organisationId: organisation.id } });
      await db.audioRender.deleteMany({ where: { organisationId: organisation.id } });
      await db.audioProjectVersion.deleteMany({ where: { project: { organisationId: organisation.id } } });
      await db.audioProject.deleteMany({ where: { organisationId: organisation.id } });
      if (promo) {
        await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: null } });
        await db.promoVersion.deleteMany({ where: { promoAssetId: promo.id } });
        await db.promoAsset.delete({ where: { id: promo.id } });
      }
      if (media) await db.mediaAsset.delete({ where: { id: media.id } });
      await db.player.deleteMany({ where: { organisationId: organisation.id } });
      await db.channelAssignment.deleteMany({ where: { channel: { organisationId: organisation.id } } });
      await db.channel.deleteMany({ where: { organisationId: organisation.id } });
      await db.station.deleteMany({ where: { organisationId: organisation.id } });
      await db.location.deleteMany({ where: { organisationId: organisation.id } });
      await db.auditLog.deleteMany({ where: { organisationId: organisation.id } });
      await db.subscription.deleteMany({ where: { organisationId: organisation.id } });
      await db.organisation.delete({ where: { id: organisation.id } });
    }
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});
