import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";
import { correctionsRenderEvidence } from "../../lib/corrections-workflow.mjs";
import { localDateTimeParts } from "../../lib/opening-hours.mjs";
import { verifyEdgeManifest } from "../../lib/corrections-edge-manifest.mjs";
import { verifyCorrectionsEdgePlayerGrant } from "../../lib/corrections-edge-player-grant.mjs";
import { signCorrectionsEdgeProof } from "../../lib/corrections-edge-proof.mjs";
import { CorrectionsEdgeSyncClient } from "../../edge/sync-client.mjs";
import { createCorrectionsEdgeServer } from "../../edge/server.mjs";
import { isPrivateLanIpv4 } from "../../scripts/c8-lan-proxy.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3108";
const ciDatabase = process.env.C8_CI_INTEGRATION === "true" && process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";
const disposableLocalDatabase = process.env.C8_LOCAL_INTEGRATION === "true" &&
  process.env.DATABASE_URL === "postgresql://c8lab@127.0.0.1:5548/ruvanas_c8_migration_clean";
const isolatedIntegration = ciDatabase || disposableLocalDatabase;
const objectStoreBucket = ciDatabase ? "c7-test" : "c8-test";
const objectStorePort = ciDatabase ? 9107 : 9108;
const audibleLab = process.env.C8_AUDIBLE_LAB === "true";
const twoHostLab = process.env.C8_TWO_HOST_LAB === "true";

function twoHostOrigins() {
  if (!twoHostLab) return null;
  if (!audibleLab || !disposableLocalDatabase || process.env.C8_SYNTHETIC_ONLY !== "true" ||
      process.env.NODE_ENV === "production") {
    throw new Error("Two-host C8 lab needs audible synthetic mode and the exact disposable local database.");
  }
  const origin = (value) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !isPrivateLanIpv4(parsed.hostname) ||
        parsed.origin !== value.replace(/\/$/, "") || parsed.pathname !== "/" ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("C8 two-host origins must be exact HTTPS RFC1918 IP origins.");
    }
    return parsed.origin;
  };
  const cloud = origin(process.env.C8_LAN_CLOUD_ORIGIN);
  const edge = origin(process.env.C8_LAN_EDGE_ORIGIN);
  if (new URL(cloud).hostname === new URL(edge).hostname) {
    throw new Error("The C8 cloud and Edge must run on different LAN PCs.");
  }
  return { cloud, edge };
}
const playerInstanceId = randomUUID();
const testPrivateKey = createPrivateKey({ key: Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)
]), format: "der", type: "pkcs8" });
const testPublicPem = createPublicKey(testPrivateKey).export({ type: "spki", format: "pem" });

function syntheticToneWav(frequency, seconds = 2) {
  const sampleRate = 44_100;
  const sampleCount = sampleRate * seconds;
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 1_000, (sampleCount - index) / 1_000);
    bytes.writeInt16LE(Math.round(11_000 * fade * Math.sin(2 * Math.PI * frequency * index / sampleRate)),
      44 + index * 2);
  }
  return bytes;
}

async function api(path, { method = "GET", body, cookie, machine, enrolCredential, noOrigin = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(noOrigin ? {} : { origin: baseUrl }),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(cookie ? { cookie } : {}), ...(cookie?.startsWith("ruvanas_player=") ?
      { "X-Ruvanas-Player-Instance": playerInstanceId } : {}),
    ...((machine || enrolCredential) ? { authorization: `Bearer ${machine || enrolCredential}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("C8B signed C7 manifest/media is exact, protected, facility-scoped and withdrawn on resync", {
  skip: !isolatedIntegration ? "Requires the exact disposable C8 lab or CI database." : false
}, async () => {
  if (!isolatedIntegration || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C8 manifest integration is restricted to the exact disposable CI or local test database.");
  }
  const lanOrigins = twoHostOrigins();
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const password = `C8-manifest-${randomUUID()}!`;
  const mediaBytes = audibleLab ? syntheticToneWav(440) : Buffer.from("synthetic, private C8 programme audio");
  const storageKey = `c8-${suffix}/programme.wav`;
  const localBytes = audibleLab ? syntheticToneWav(770) : null;
  const localStorageKey = `c8-${suffix}/local.wav`;
  const priorityBytes = audibleLab ? syntheticToneWav(990) : null;
  const priorityStorageKey = `c8-${suffix}/priority.wav`;
  const emergencyBytes = audibleLab ? syntheticToneWav(220) : null;
  const emergencyStorageKey = `c8-${suffix}/emergency.wav`;
  const licensedBytes = audibleLab ? syntheticToneWav(660) :
    Buffer.from(`synthetic, licensed C8 catalogue audio ${suffix}`);
  const licensedChecksum = createHash("sha256").update(licensedBytes).digest("hex");
  const licensedStorageKey = `catalogue/music/${licensedChecksum}.wav`;
  const mockR2 = createServer((request, response) => {
    const objectPath = new URL(request.url, "http://localhost").pathname;
    const bytes = objectPath === `/${objectStoreBucket}/${storageKey}` ? mediaBytes :
      objectPath === `/${objectStoreBucket}/${localStorageKey}` ? localBytes :
      objectPath === `/${objectStoreBucket}/${priorityStorageKey}` ? priorityBytes :
      objectPath === `/${objectStoreBucket}/${emergencyStorageKey}` ? emergencyBytes :
      objectPath === `/${objectStoreBucket}/${licensedStorageKey}` ? licensedBytes : null;
    if (request.method !== "GET" || !bytes) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": bytes.length });
    response.end(bytes);
  });
  let organisation, plan, media, promo, localMedia, localPromo, localDistribution,
    priorityMedia, priorityPromo, emergencyMedia, emergencyPromo, labAnnouncementIds,
    licensedMedia, licensedGenre, archiverUserId,
    users = [], edgeRoot, localEdge, labController, cloudLink, cloudLinkPort;
  let cloudConnected = false;
  async function connectCloudLink() {
    if (cloudLink?.listening) return;
    cloudLink = createServer((request, response) => {
      const target = new URL(request.url, baseUrl);
      const upstream = httpRequest(target, { method: request.method,
        headers: { ...request.headers, host: target.host } }, (source) => {
        response.writeHead(source.statusCode, source.headers);
        source.pipe(response);
      });
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      request.on("aborted", () => upstream.destroy());
      request.pipe(upstream);
    });
    await new Promise((resolve, reject) => cloudLink.once("error", reject)
      .listen(cloudLinkPort || 0, "127.0.0.1", resolve));
    cloudLinkPort = cloudLink.address().port;
    cloudConnected = true;
  }
  async function disconnectCloudLink() {
    if (!cloudLink) return;
    const activeLink = cloudLink;
    activeLink.closeAllConnections();
    await new Promise((resolve, reject) => activeLink.close((error) => error ? reject(error) : resolve()));
    cloudLink = null;
    cloudConnected = false;
  }
  try {
    await new Promise((resolve, reject) => mockR2.once("error", reject).listen(objectStorePort, "127.0.0.1", resolve));
    plan = await db.plan.create({ data: { name: `C8 manifest ${suffix}`, code: `C8_MANIFEST_${suffix}`,
      productFamily: "CORRECTIONS", tierNumber: 4, monthlyPriceCents: 49900, storageLimitGb: 10,
      listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true,
      licensedMusicCatalogueLevel: "PREMIUM", stationLimit: 4 } });
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
    archiverUserId = admin.user.id;
    const owner = await user("OWNER", "owner-manifest");
    const manager = await user("MANAGER", "manager-manifest");
    const ownerMembership = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: owner.user.id,
      role: "OWNER" } });
    const managerMembership = audibleLab ? await db.organisationMember.create({ data: {
      organisationId: organisation.id, userId: manager.user.id, role: "MANAGER" } }) : null;
    const facilities = [];
    for (const label of ["A", "B"]) facilities.push(await db.location.create({ data: {
      organisationId: organisation.id, name: `C8 facility ${label}`, slug: `c8-${label}-${suffix}`,
      status: "ACTIVE", countryCode: "MT", timezone: "Europe/Malta",
      zones: { create: { name: "Wing 1", slug: "wing-1", status: "ACTIVE" } },
      correctionsFacility: { create: { policyConfiguredAt: new Date(), requestAvailability: "INTERNAL_ONLY",
        songRequestsEnabled: true, priorityEnabled: audibleLab, emergencyEnabled: audibleLab } }
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
      sizeBytes: BigInt(mediaBytes.length), durationSeconds: 2, mediaType: "ANNOUNCEMENT", status: "READY" } });
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
    // Keep the synthetic Central programme valid if this test crosses Malta midnight.
    // A real weekly schedule likewise needs an explicit window for each day.
    const centralWindows = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      centralWindows.push(await db.correctionsNetworkWindow.create({ data: {
        organisationId: organisation.id, facilityId: facilities[0].id, kind: "CENTRAL",
        distributionId: distribution.id, weekday, startMinute: 0, endMinute: 1440,
        allowedContentTypes: ["PROGRAMME"], createdByUserId: owner.user.id } }));
    }
    async function edgeFor(facility) {
      const created = await api("/api/admin/corrections/edge", { method: "POST", cookie: admin.cookie,
        body: { organisationId: organisation.id, facilityId: facility.id, name: `Synthetic Edge ${facility.name}` } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const enrolled = await api("/api/corrections/edge/enrol", { method: "POST",
        enrolCredential: created.body.enrolmentCredential, noOrigin: true,
        body: { enrolmentCredential: created.body.enrolmentCredential, proofPublicKeyPem: testPublicPem } });
      assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
      return { id: created.body.nodeId, credential: enrolled.body.machineCredential };
    }
    const edgeA = await edgeFor(facilities[0]);
    const edgeB = await edgeFor(facilities[1]);
    const insideFleet = await fetch(`${baseUrl}/dashboard/corrections/edge`, { headers: { cookie: owner.cookie } });
    assert.equal(insideFleet.status, 200);
    assert.match(await insideFleet.text(), /Secure Edge fleet/);
    const manifestA = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(manifestA.status, 200, JSON.stringify(manifestA.body));
    assert.equal(verifyEdgeManifest(manifestA.body, testPublicPem,
      { nodeId: edgeA.id, organisationId: organisation.id, facilityId: facilities[0].id }), true);
    assert.equal(manifestA.body.payload.content.length, 1);
    const manifestB = await api("/api/corrections/edge/manifest", { machine: edgeB.credential });
    assert.equal(manifestB.status, 200);
    assert.equal(manifestB.body.payload.content.length, 0);
    const bindA = await api(`/api/admin/corrections/edge/${edgeA.id}`, { method: "POST", cookie: admin.cookie,
      body: { action: "SET_PLAYER_ENDPOINT", origin: "https://edge-a.example.invalid:8443" } });
    assert.equal(bindA.status, 200, JSON.stringify(bindA.body));
    const playerState = await api("/api/player/state", { cookie: players[0].cookie });
    assert.equal(playerState.status, 200, JSON.stringify(playerState.body));
    assert.equal(playerState.body.secureEdge.nodeId, edgeA.id);
    assert.equal(playerState.body.secureEdge.facilityId, facilities[0].id);
    assert.equal(playerState.body.secureEdge.zoneId, facilities[0].zones[0].id);
    assert.equal(playerState.body.secureEdge.endpointOrigin, "https://edge-a.example.invalid:8443");
    assert.equal(playerState.body.channel.streamUrl, null, "private players cannot fall back to a public stream");
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
    const content = manifestA.body.payload.content[0];
    const scope = { nodeId: edgeA.id, organisationId: organisation.id, facilityId: facilities[0].id };
    const sessionId = randomUUID();
    const startTime = new Date(Math.max(Date.now(), Date.parse(manifestA.body.payload.issuedAt) + 100));
    const signedWindow = manifestA.body.payload.windows.find((item) =>
      item.weekday === localDateTimeParts(startTime, "Europe/Malta").weekday);
    assert.ok(signedWindow, "the signed manifest covers the proof's Malta weekday");
    assert.ok(centralWindows.some((item) => item.id === signedWindow.id));
    assert.equal(signedWindow.sourceRevision,
      `c7:${signedWindow.id}:${distribution.id}:${submission.id}:${submission.sourceFingerprint}`);
    const baseProof = { schema: 1, ...scope, zoneId: facilities[0].zones[0].id,
      playerId: players[0].player.id, sessionId, manifestVersion: manifestA.body.version,
      contentKey: `${content.mediaAssetId}:${content.promoVersionId}:${content.sha256}`,
      programmingSource: signedWindow.programmingSource, windowId: signedWindow.id, overrideId: null };
    const started = signCorrectionsEdgeProof(1, null, { ...baseProof, eventId: randomUUID(),
      eventType: "STARTED", occurredAt: startTime.toISOString(), positionSeconds: 0 },
      testPrivateKey.export({ type: "pkcs8", format: "pem" }));
    const completed = signCorrectionsEdgeProof(2, started.eventHash, { ...baseProof, eventId: randomUUID(),
      eventType: "COMPLETED", occurredAt: new Date(startTime.getTime() + 2000).toISOString(), positionSeconds: 2 },
      testPrivateKey.export({ type: "pkcs8", format: "pem" }));
    const rejectedCrossFacility = await api("/api/corrections/edge/proof", { method: "POST", machine: edgeB.credential,
      body: { records: [started] } });
    assert.equal(rejectedCrossFacility.status, 400);
    const rejectedForgery = await api("/api/corrections/edge/proof", { method: "POST", machine: edgeA.credential,
      body: { records: [{ ...started, payload: { ...started.payload, contentKey: "other:version:" + "0".repeat(64) } }] } });
    assert.equal(rejectedForgery.status, 409, JSON.stringify(rejectedForgery.body));
    const proofUpload = await api("/api/corrections/edge/proof", { method: "POST", machine: edgeA.credential,
      body: { records: [started, completed] } });
    assert.equal(proofUpload.status, 200, JSON.stringify(proofUpload.body));
    assert.equal(proofUpload.body.accepted, 2);
    const replay = await api("/api/corrections/edge/proof", { method: "POST", machine: edgeA.credential,
      body: { records: [started, completed] } });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.duplicates, 2);
    assert.equal(await db.proofOfPlayEvent.count({ where: { organisationId: organisation.id,
      playerId: players[0].player.id, programmingSource: "CORRECTIONS_CENTRAL" } }), 2);
    assert.equal(await db.playoutIntent.count({ where: { organisationId: organisation.id,
      correctionsProgrammeId: programme.id, correctionsSubmissionId: submission.id } }), 1);
    // A single explicitly staff-scheduled C5 song is eligible for the local
    // cache; neither the whole catalogue nor an arbitrary provider asset is.
    licensedGenre = await db.mediaGenre.create({ data: { name: `C8 Pop ${suffix}`, slug: `pop-${suffix}`,
      minimumCatalogueLevel: "PREMIUM" } });
    licensedMedia = await db.mediaAsset.create({ data: { organisationId: null,
      libraryType: "RUVANAS_CATALOGUE", licensedCatalogue: true, name: "C8 test catalogue tone",
      originalName: "c8-licensed.wav", storageKey: licensedStorageKey, mimeType: "audio/wav",
      sizeBytes: BigInt(licensedBytes.length), durationSeconds: 2, mediaType: "MUSIC", status: "READY",
      genres: { create: { mediaGenreId: licensedGenre.id, isPrimary: true } } } });
    const licensedTrack = await db.track.create({ data: { mediaAssetId: licensedMedia.id,
      title: "C8 test catalogue tone", artist: "Synthetic Test", status: "READY",
      minimumCatalogueLevel: "PREMIUM", permittedTerritories: "EUROPE",
      permittedUses: ["CORRECTIONS_RADIO"], rightsReviewStatus: "APPROVED",
      catalogueProvider: "SYNTHETIC_TEST" } });
    const licensedRequest = await db.correctionsRequest.create({ data: {
      organisationId: organisation.id, facilityId: facilities[0].id, source: "INTERNAL",
      type: "SONG", status: "SCHEDULED", songTitle: licensedTrack.title,
      trackId: licensedTrack.id, programmeId: programme.id } });
    const licensedIntent = await db.playoutIntent.create({ data: {
      scheduleItemId: `c8-licensed-${suffix}`, organisationId: organisation.id,
      playerId: players[0].player.id, zoneId: facilities[0].zones[0].id,
      channelId: channel.id, locationId: facilities[0].id,
      locationName: facilities[0].name, locationTimezone: "Europe/Malta", locationGroups: [],
      mediaAssetId: licensedMedia.id, publicationRevision: 1,
      sourceRevision: `${submission.id}:${submission.sourceFingerprint}`,
      // The policy/takedown resyncs below must decide eligibility, not a CI timing race.
      plannedStart: new Date(Date.now() - 5000), expiresAt: new Date(Date.now() + 30 * 60_000),
      correctionsRequestId: licensedRequest.id, correctionsProgrammeId: programme.id,
      correctionsSubmissionId: submission.id, correctionsTrackId: licensedTrack.id } });
    const licensedManifest = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(licensedManifest.status, 200, JSON.stringify(licensedManifest.body));
    assert.equal(licensedManifest.body.payload.insertions.length, 1,
      "only the staff-scheduled eligible song enters the signed manifest");
    assert.equal(licensedManifest.body.payload.content.some((item) => item.trackId === licensedTrack.id), true);
    const licensedFetch = await fetch(`${baseUrl}/api/corrections/edge/media/${licensedMedia.id}`,
      { headers: { authorization: `Bearer ${edgeA.credential}` } });
    assert.equal(licensedFetch.status, 200);
    assert.deepEqual(Buffer.from(await licensedFetch.arrayBuffer()), licensedBytes);
    assert.equal((await api(`/api/corrections/edge/media/${licensedMedia.id}`,
      { machine: edgeB.credential })).status, 404, "another facility cannot retrieve the catalogue item");
    const signedInsertion = licensedManifest.body.payload.insertions[0];
    const signedTrack = licensedManifest.body.payload.content.find((item) => item.trackId === licensedTrack.id);
    const songSessionId = randomUUID();
    const songStartAt = new Date(Math.max(Date.now(), Date.parse(licensedManifest.body.payload.issuedAt) + 100));
    const songProofBase = { schema: 1, ...scope, zoneId: facilities[0].zones[0].id,
      playerId: players[0].player.id, sessionId: songSessionId,
      manifestVersion: licensedManifest.body.version,
      contentKey: `${signedTrack.mediaAssetId}:${signedTrack.promoVersionId}:${signedTrack.sha256}`,
      programmingSource: "CORRECTIONS_REQUEST", windowId: null, overrideId: null,
      insertionId: signedInsertion.id };
    const songStarted = signCorrectionsEdgeProof(3, completed.eventHash,
      { ...songProofBase, eventId: randomUUID(), eventType: "STARTED",
        occurredAt: songStartAt.toISOString(), positionSeconds: 0 },
      testPrivateKey.export({ type: "pkcs8", format: "pem" }));
    const songCompleted = signCorrectionsEdgeProof(4, songStarted.eventHash,
      { ...songProofBase, eventId: randomUUID(), eventType: "COMPLETED",
        occurredAt: new Date(songStartAt.getTime() + 2000).toISOString(), positionSeconds: 2 },
      testPrivateKey.export({ type: "pkcs8", format: "pem" }));
    const songReconciled = await api("/api/corrections/edge/proof", { method: "POST",
      machine: edgeA.credential, body: { records: [songStarted, songCompleted] } });
    assert.equal(songReconciled.status, 200, JSON.stringify(songReconciled.body));
    assert.equal(songReconciled.body.accepted, 2);
    assert.equal(await db.rightsUsageLedgerEvent.count({ where: {
      organisationId: organisation.id, trackId: licensedTrack.id, rightsUse: "CORRECTIONS_RADIO" } }), 1);
    assert.equal((await api("/api/corrections/edge/proof", { method: "POST", machine: edgeA.credential,
      body: { records: [songStarted, songCompleted] } })).body.duplicates, 2);
    await db.correctionsProfile.update({ where: { organisationId: organisation.id },
      data: { blockedTrackIds: [licensedTrack.id.toLowerCase()] } });
    const blocked = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    assert.equal(blocked.body.payload.insertions.length, 0, "central policy withdrawal is applied on sync");
    assert.equal((await api(`/api/corrections/edge/media/${licensedMedia.id}`,
      { machine: edgeA.credential })).status, 404);
    await db.correctionsProfile.update({ where: { organisationId: organisation.id },
      data: { blockedTrackIds: [] } });
    const centralRestored = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(centralRestored.status, 200);
    assert.equal(centralRestored.body.payload.insertions.length, 1);
    await db.correctionsFacility.update({ where: { locationId: facilities[0].id },
      data: { blockedTrackIds: [licensedTrack.id.toLowerCase()] } });
    const facilityBlocked = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(facilityBlocked.status, 200);
    assert.equal(facilityBlocked.body.payload.insertions.length, 0, "facility policy cannot be bypassed");
    await db.correctionsFacility.update({ where: { locationId: facilities[0].id },
      data: { blockedTrackIds: [] } });
    const facilityRestored = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(facilityRestored.status, 200);
    assert.equal(facilityRestored.body.payload.insertions.length, 1);
    await db.plan.update({ where: { id: plan.id }, data: { licensedMusicCatalogueLevel: "FOCUSED" } });
    const tierBlocked = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(tierBlocked.status, 200);
    assert.equal(tierBlocked.body.payload.insertions.length, 0, "higher-tier catalogue music is excluded");
    await db.plan.update({ where: { id: plan.id }, data: { licensedMusicCatalogueLevel: "PREMIUM" } });
    await db.track.update({ where: { id: licensedTrack.id }, data: { status: "ARCHIVED" } });
    const takenDown = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(takenDown.status, 200);
    assert.equal(takenDown.body.payload.insertions.length, 0, "taken-down tracks are excluded");
    await db.playoutIntent.delete({ where: { id: licensedIntent.id } });
    // Real Edge runtime against the isolated cloud: disconnect, keep serving
    // signed private audio, queue local proof, withdraw, reconnect and evict.
    const labPlayerCodes = [];
    if (audibleLab) {
      const staffPath = `/api/corrections/facilities/${facilities[0].id}/staff`;
      const ownerGrant = await api(staffPath, { method: "POST", cookie: owner.cookie,
        body: { memberId: ownerMembership.id, permission: "MANAGER",
          canEmergencyActivate: true, canEmergencyClear: true } });
      assert.equal(ownerGrant.status, 200, JSON.stringify(ownerGrant.body));
      const managerGrant = await api(staffPath, { method: "POST", cookie: owner.cookie,
        body: { memberId: managerMembership.id, permission: "MANAGER",
          canPriorityActivate: true, canPriorityStop: true } });
      assert.equal(managerGrant.status, 200, JSON.stringify(managerGrant.body));
      async function approvedAnnouncement(name, bytes, storageKey) {
        const mediaAsset = await db.mediaAsset.create({ data: { organisationId: organisation.id,
          libraryType: "ORGANISATION_PROMO", name, originalName: `${name}.wav`, storageKey,
          mimeType: "audio/wav", sizeBytes: BigInt(bytes.length), durationSeconds: 2,
          mediaType: "ANNOUNCEMENT", status: "READY" } });
        const promoAsset = await db.promoAsset.create({ data: { organisationId: organisation.id,
          name, mediaType: "ANNOUNCEMENT" } });
        const promoVersion = await db.promoVersion.create({ data: { promoAssetId: promoAsset.id,
          mediaAssetId: mediaAsset.id, version: 1, status: "APPROVED", qcStatus: "PASSED",
          checksumSha256: createHash("sha256").update(bytes).digest("hex") } });
        await db.promoAsset.update({ where: { id: promoAsset.id },
          data: { currentApprovedVersionId: promoVersion.id } });
        const created = await api("/api/corrections/announcements", { method: "POST", cookie: owner.cookie,
          body: { facilityId: facilities[0].id, title: name, promoVersionId: promoVersion.id } });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const approved = await api(`/api/corrections/announcements/${created.body.announcement.id}/approve`,
          { method: "POST", cookie: manager.cookie });
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        return { mediaAsset, promoAsset, announcementId: created.body.announcement.id };
      }
      const priority = await approvedAnnouncement("C8 Priority tone", priorityBytes, priorityStorageKey);
      priorityMedia = priority.mediaAsset; priorityPromo = priority.promoAsset;
      const emergency = await approvedAnnouncement("C8 Emergency tone", emergencyBytes, emergencyStorageKey);
      emergencyMedia = emergency.mediaAsset; emergencyPromo = emergency.promoAsset;
      labAnnouncementIds = { priority: priority.announcementId, emergency: emergency.announcementId };
      localMedia = await db.mediaAsset.create({ data: { organisationId: organisation.id,
        libraryType: "ORGANISATION_PROMO", name: "Private local programme", originalName: "local-synthetic.wav",
        storageKey: localStorageKey, mimeType: "audio/wav", sizeBytes: BigInt(localBytes.length),
        durationSeconds: 2, mediaType: "ANNOUNCEMENT", status: "READY" } });
      localPromo = await db.promoAsset.create({ data: { organisationId: organisation.id,
        name: "Private local programme", mediaType: "ANNOUNCEMENT" } });
      const localChecksum = createHash("sha256").update(localBytes).digest("hex");
      const localPromoVersion = await db.promoVersion.create({ data: { promoAssetId: localPromo.id,
        mediaAssetId: localMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED",
        checksumSha256: localChecksum } });
      await db.promoAsset.update({ where: { id: localPromo.id },
        data: { currentApprovedVersionId: localPromoVersion.id } });
      const localProject = await db.audioProject.create({ data: { organisationId: organisation.id,
        title: "C8 local programme", editDecision: {}, createdByUserId: owner.user.id } });
      const localProjectVersion = await db.audioProjectVersion.create({ data: { projectId: localProject.id,
        version: 1, state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: localMedia.id }] } },
        createdByUserId: owner.user.id } });
      await db.audioTake.create({ data: { organisationId: organisation.id, projectId: localProject.id,
        mediaAssetId: localMedia.id, promoVersionId: localPromoVersion.id,
        recordedByUserId: owner.user.id, status: "READY", sourceEditDecision: {} } });
      const localRender = await db.audioRender.create({ data: { organisationId: organisation.id,
        projectId: localProject.id, versionId: localProjectVersion.id, outputMediaAssetId: localMedia.id,
        outputPromoVersionId: localPromoVersion.id, requestedByUserId: owner.user.id,
        preset: "SPEECH_MP3", status: "SUCCEEDED", completedAt: new Date(),
        resultJson: { checksumSha256: localChecksum } } });
      const localEvidence = correctionsRenderEvidence(await db.audioRender.findUnique({
        where: { id: localRender.id }, include: { outputMediaAsset: true, outputPromoVersion: true,
          version: { select: { state: true } }, project: { select: { organisationId: true,
            createdByUserId: true, currentVersion: true, title: true } } } }));
      const localProgramme = await db.correctionsProgramme.create({ data: { organisationId: organisation.id,
        facilityId: facilities[0].id, title: "C8 local programme", createdByUserId: owner.user.id,
        networkOrigin: "FACILITY", status: "APPROVED", latestRevision: 1 } });
      const localSubmission = await db.correctionsSubmission.create({ data: { programmeId: localProgramme.id,
        organisationId: organisation.id, facilityId: facilities[0].id, revision: 1, renderId: localRender.id,
        sourceFingerprint: localEvidence.fingerprint, organisationPolicyVersion: 1, facilityPolicyVersion: 1,
        titleSnapshot: "C8 local programme", evidenceSnapshot: localEvidence,
        submittedByUserId: owner.user.id, status: "APPROVED" } });
      await db.correctionsReview.create({ data: { submissionId: localSubmission.id, stage: "STAFF",
        decision: "APPROVE", note: "Synthetic local-window review", evidenceSnapshot: {},
        reviewedByUserId: manager.user.id } });
      localDistribution = await db.correctionsProgrammeDistribution.create({ data: {
        organisationId: organisation.id, sourceFacilityId: facilities[0].id,
        targetFacilityId: facilities[0].id, programmeId: localProgramme.id,
        submissionId: localSubmission.id, effectiveFrom: new Date(Date.now() - 60_000),
        createdByUserId: owner.user.id } });
      const wingTwo = await db.zone.create({ data: { locationId: facilities[0].id,
        name: "Wing 2", slug: "wing-2", status: "ACTIVE" } });
      await db.channelAssignment.create({ data: { channelId: channel.id, zoneId: wingTwo.id,
        activeFrom: new Date(Date.now() - 60_000) } });
      for (const [label, zoneId] of [["A", facilities[0].zones[0].id], ["B", wingTwo.id]]) {
        const code = `C8-LAB-${randomUUID()}`;
        const labPlayer = await db.player.create({ data: { organisationId: organisation.id, zoneId,
          name: `C8 audible player ${label}`, status: "PENDING_ENROLMENT",
          enrolmentTokenHash: hashPlayerToken(code, process.env.SESSION_SECRET),
          enrolmentExpiresAt: new Date(Date.now() + 60 * 60_000), enrolledAt: new Date() } });
        labPlayerCodes.push({ label, zoneId, playerId: labPlayer.id, code });
      }
    }
    const edgeC = await edgeFor(facilities[0]);
    const unbindA = await api(`/api/admin/corrections/edge/${edgeA.id}`, { method: "POST", cookie: admin.cookie,
      body: { action: "SET_PLAYER_ENDPOINT", origin: null } });
    assert.equal(unbindA.status, 200, JSON.stringify(unbindA.body));
    const bindC = await api(`/api/admin/corrections/edge/${edgeC.id}`, { method: "POST", cookie: admin.cookie,
      body: { action: "SET_PLAYER_ENDPOINT", origin: lanOrigins?.edge || "https://edge-c.example.invalid:8443" } });
    assert.equal(bindC.status, 200, JSON.stringify(bindC.body));
    edgeRoot = await mkdtemp(path.join(os.tmpdir(), "ruvanas-c8-reconnect-"));
    let runtime = null;
    let localUrl = lanOrigins?.edge;
    let bundlePath = null;
    let publicKeyPath = null;
    if (lanOrigins) {
      // Only synthetic, short-lived lab credentials are exported. The file is
      // never logged and is removed with the fixture at /stop. The operator
      // must separately protect its filesystem ACL on Windows.
      bundlePath = path.join(edgeRoot, "synthetic-edge-bootstrap.json");
      publicKeyPath = path.join(edgeRoot, "synthetic-edge-public.pem");
      await writeFile(bundlePath, JSON.stringify({
        nodeId: edgeC.id, organisationId: organisation.id, facilityId: facilities[0].id,
        machineCredential: edgeC.credential, cacheKey: randomBytes(32).toString("base64url"),
        cloudPublicKeyPem: testPublicPem,
        proofPrivateKeyPem: testPrivateKey.export({ type: "pkcs8", format: "pem" })
      }), { mode: 0o600, flag: "wx" });
      await writeFile(publicKeyPath, testPublicPem, { mode: 0o600, flag: "wx" });
    } else {
      await connectCloudLink();
      runtime = new CorrectionsEdgeSyncClient({ cloudUrl: `http://127.0.0.1:${cloudLinkPort}`,
        machineCredential: edgeC.credential, root: edgeRoot, cacheKey: randomBytes(32),
        publicKeyPem: testPublicPem, proofPrivateKeyPem: testPrivateKey.export({ type: "pkcs8", format: "pem" }),
        scope: { ...scope, nodeId: edgeC.id } });
      await runtime.initialise();
      const initialSync = await runtime.sync({ softwareVersion: "c8-isolated-runtime" });
      assert.equal(initialSync.downloaded, 1);
      localEdge = createCorrectionsEdgeServer({ cache: runtime.cache, proofQueue: runtime.proofQueue,
        allowedPlayerOrigin: audibleLab ? baseUrl : null });
      const address = await localEdge.listen();
      localUrl = `http://127.0.0.1:${address.port}`;
    }
    if (audibleLab) {
      if (!lanOrigins) {
        const localBinding = await api(`/api/admin/corrections/edge/${edgeC.id}`, { method: "POST",
          cookie: admin.cookie, body: { action: "SET_PLAYER_ENDPOINT", origin: localUrl } });
        assert.equal(localBinding.status, 200, JSON.stringify(localBinding.body));
      }
      let releaseLab;
      let activePriorityId;
      let activeEmergencyId;
      labController = createServer(async (request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname;
        const send = (status, body) => { response.writeHead(status, { "Content-Type": "application/json",
          "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); };
        try {
          if (request.method === "GET" && path === "/status") return send(200, {
            cloudConnected: lanOrigins ? null : cloudConnected, manifestVersion: runtime?.cache.active?.version || null,
            pendingProof: runtime?.proofQueue.pendingCount ?? null,
            remoteEdge: Boolean(lanOrigins),
            cloudProof: await db.correctionsEdgeProofEvent.count({ where: { nodeId: edgeC.id } }) });
          if (request.method === "POST" && path === "/disconnect") {
            if (lanOrigins) return send(409, { error: "Stop only the loopback Edge cloud-link process on the Edge PC." });
            await disconnectCloudLink(); return send(200, { cloudConnected });
          }
          if (request.method === "POST" && path === "/schedule-local") {
            if (!lanOrigins && !cloudConnected) return send(409, { error: "Local window must be signed before disconnection." });
            const start = localDateTimeParts(new Date(Date.now() + 60_000), "Europe/Malta");
            if (start.minute >= 1439) return send(409, { error: "Retry after local midnight." });
            const localWindow = await db.correctionsNetworkWindow.create({ data: {
              organisationId: organisation.id, facilityId: facilities[0].id, kind: "LOCAL",
              distributionId: localDistribution.id, weekday: start.weekday,
              startMinute: start.minute, endMinute: start.minute + 1,
              allowedContentTypes: ["PROGRAMME"], createdByUserId: owner.user.id } });
            const sync = lanOrigins ? { remoteEdgeSyncRequiredBeforeCut: true } :
              await runtime.sync({ softwareVersion: "c8-audible-c7" });
            return send(200, { windowId: localWindow.id, startsAtLocalMinute: start.minute,
              durationMinutes: 1, sync });
          }
          if (request.method === "POST" && path === "/withdraw") {
            await db.correctionsProgrammeDistribution.update({ where: { id: distribution.id },
              data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
            await db.correctionsNetworkWindow.updateMany({ where: {
              organisationId: organisation.id, distributionId: distribution.id },
              data: { active: false } });
            return send(200, { cloudConnected, withdrawnInCloud: true });
          }
          if (request.method === "POST" && path === "/reconnect") {
            if (lanOrigins) return send(409, { error: "Restart the loopback Edge cloud-link process on the Edge PC." });
            await connectCloudLink();
            return send(200, { cloudConnected, sync: await runtime.sync({ softwareVersion: "c8-audible-lab" }) });
          }
          if (request.method === "POST" && path === "/priority") {
            if (!lanOrigins && !cloudConnected) return send(409, { error: "Cloud cannot deliver a new override while disconnected." });
            const started = await api("/api/corrections/overrides", { method: "POST", cookie: manager.cookie,
              body: { facilityId: facilities[0].id, zoneIds: labPlayerCodes.map((item) => item.zoneId),
                announcementId: labAnnouncementIds.priority, type: "PRIORITY",
                category: "URGENT_FACILITY_NOTICE", idempotencyKey: randomUUID() } });
            if (started.status !== 200) return send(started.status, started.body);
            activePriorityId = started.body.override.id;
            return send(200, { overrideId: activePriorityId,
              sync: lanOrigins ? { remoteEdgeSyncRequired: true } : await runtime.sync({ softwareVersion: "c8-audible-c6" }) });
          }
          if (request.method === "POST" && path === "/clear-priority") {
            if ((!lanOrigins && !cloudConnected) || !activePriorityId) return send(409, { error: "No connected Priority override." });
            const cleared = await api(`/api/corrections/overrides/${activePriorityId}/clear`,
              { method: "POST", cookie: manager.cookie });
            if (cleared.status !== 200) return send(cleared.status, cleared.body);
            activePriorityId = null;
            return send(200, { cleared: true,
              sync: lanOrigins ? { remoteEdgeSyncRequired: true } : await runtime.sync({ softwareVersion: "c8-audible-c6" }) });
          }
          if (request.method === "POST" && path === "/emergency") {
            if (!lanOrigins && !cloudConnected) return send(409, { error: "Cloud cannot deliver a new override while disconnected." });
            const started = await api("/api/corrections/overrides", { method: "POST", cookie: owner.cookie,
              body: { facilityId: facilities[0].id, zoneIds: labPlayerCodes.map((item) => item.zoneId),
                announcementId: labAnnouncementIds.emergency, type: "EMERGENCY",
                category: "EMERGENCY_INSTRUCTION", confirmation: "START EMERGENCY",
                idempotencyKey: randomUUID() } });
            if (started.status !== 200) return send(started.status, started.body);
            activeEmergencyId = started.body.override.id;
            return send(200, { overrideId: activeEmergencyId,
              sync: lanOrigins ? { remoteEdgeSyncRequired: true } : await runtime.sync({ softwareVersion: "c8-audible-c6" }) });
          }
          if (request.method === "POST" && path === "/clear-emergency") {
            if ((!lanOrigins && !cloudConnected) || !activeEmergencyId) return send(409, { error: "No connected Emergency override." });
            const cleared = await api(`/api/corrections/overrides/${activeEmergencyId}/clear`,
              { method: "POST", cookie: owner.cookie });
            if (cleared.status !== 200) return send(cleared.status, cleared.body);
            activeEmergencyId = null;
            return send(200, { cleared: true,
              sync: lanOrigins ? { remoteEdgeSyncRequired: true } : await runtime.sync({ softwareVersion: "c8-audible-c6" }) });
          }
          if (request.method === "POST" && path === "/stop") {
            send(200, { stopping: true }); releaseLab(); return;
          }
          return send(404, { error: "Unknown isolated C8 lab action." });
        } catch (error) { return send(500, { error: error.message }); }
      });
      await new Promise((resolve, reject) => labController.once("error", reject).listen(9110, "127.0.0.1", resolve));
      process.stdout.write(`C8_AUDIBLE_LAB_READY ${JSON.stringify({ playerUrl: `${baseUrl}/player`,
        edgeUrl: localUrl, controlUrl: "http://127.0.0.1:9110", players: labPlayerCodes,
        ...(lanOrigins ? { syntheticBootstrapFile: bundlePath, twoHost: true,
          cloudMachineGateway: lanOrigins.cloud, nodeId: edgeC.id,
          facilityId: facilities[0].id, publicKeyFile: publicKeyPath } : {}) })}\n`);
      await new Promise((resolve) => { releaseLab = resolve; });
      return;
    }
    const localGrant = await api(`/api/player/edge-grant/${edgeC.id}`, { method: "POST", cookie: players[0].cookie });
    assert.equal(localGrant.status, 200);
    const headers = { authorization: `Edge ${Buffer.from(JSON.stringify(localGrant.body)).toString("base64url")}` };
    const before = await (await fetch(`${localUrl}/v1/playback`, { headers })).json();
    assert.equal(before.state, "READY");
    assert.deepEqual(Buffer.from(await (await fetch(`${localUrl}${before.mediaUrl}`, { headers })).arrayBuffer()), mediaBytes);
    await disconnectCloudLink();
    await assert.rejects(runtime.sync(), /fetch failed|ECONNREFUSED/);
    const reachableCloud = await fetch(baseUrl, { redirect: "manual" });
    assert.ok(reachableCloud.status >= 200 && reachableCloud.status < 500,
      "The isolated cloud remains reachable while the Edge-specific TCP link is down.");
    const offline = await (await fetch(`${localUrl}/v1/playback`, { headers })).json();
    assert.equal(offline.state, "READY");
    assert.deepEqual(Buffer.from(await (await fetch(`${localUrl}${offline.mediaUrl}`, { headers })).arrayBuffer()), mediaBytes);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const localCompletion = await fetch(`${localUrl}/v1/proof`, { method: "POST", headers: {
      ...headers, "content-type": "application/json" }, body: JSON.stringify({ sessionId: offline.sessionId,
      eventType: "COMPLETED", positionSeconds: 2 }) });
    assert.equal(localCompletion.status, 200, await localCompletion.text());
    assert.equal(runtime.proofQueue.pendingCount, 2);
    await db.correctionsProgrammeDistribution.update({ where: { id: distribution.id }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
    await db.correctionsNetworkWindow.updateMany({ where: {
      organisationId: organisation.id, distributionId: distribution.id },
      data: { active: false } });
    // The disconnected node cannot learn the withdrawal, but its *previously*
    // signed authority is bounded; reconnect must remove the item.
    assert.equal((await (await fetch(`${localUrl}/v1/playback`, { headers })).json()).state, "READY");
    await connectCloudLink();
    const reconnected = await runtime.sync({ softwareVersion: "c8-isolated-runtime" });
    assert.equal(reconnected.proofUploaded, 2);
    assert.equal(runtime.proofQueue.pendingCount, 0);
    assert.equal(runtime.cache.active.payload.content.length, 0);
    const renewedGrant = await api(`/api/player/edge-grant/${edgeC.id}`, { method: "POST", cookie: players[0].cookie });
    assert.equal(renewedGrant.status, 200);
    const renewedHeaders = { authorization: `Edge ${Buffer.from(JSON.stringify(renewedGrant.body)).toString("base64url")}` };
    assert.equal((await (await fetch(`${localUrl}/v1/playback`, { headers: renewedHeaders })).json()).state, "NO_APPROVED_SOURCE");
    assert.equal(await db.correctionsEdgeProofEvent.count({ where: { nodeId: edgeC.id } }), 2);
    assert.equal((await runtime.sync()).proofUploaded, 0, "reconnect must not duplicate accepted proof");
    const network = await api("/api/corrections/network", { cookie: owner.cookie });
    assert.equal(network.status, 200, JSON.stringify(network.body));
    assert.ok(network.body.deliveryMetricsLast7Days.centralProgramme >= 2,
      "C7 operational analytics must include reconciled Edge completion evidence");
    const date = new Date().toISOString().slice(0, 10);
    const report = await fetch(`${baseUrl}/api/corrections/network/report/export?from=${date}&to=${date}&status=COMPLETED`,
      { headers: { cookie: owner.cookie } });
    assert.equal(report.status, 200);
    assert.match(await report.text(), /CORRECTIONS_CENTRAL/);
    const withdrawn = await api("/api/corrections/edge/manifest", { machine: edgeA.credential });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.payload.content.length, 0);
    assert.equal((await api(`/api/corrections/edge/media/${media.id}`, { machine: edgeA.credential })).status, 404);
  } finally {
    if (labController) await new Promise((resolve) => labController.close(resolve));
    if (cloudLink) await disconnectCloudLink();
    if (localEdge) await new Promise((resolve) => localEdge.server.close(resolve));
    if (edgeRoot) { assert.equal(path.dirname(edgeRoot), os.tmpdir()); await rm(edgeRoot, { recursive: true, force: true }); }
    if (mockR2.listening) await new Promise((resolve) => mockR2.close(resolve));
    if (organisation) {
      // The production rights ledger is append-only. Archive the exact rows
      // through its audited reset mechanism before removing synthetic data.
      if (archiverUserId) await db.$executeRaw`INSERT INTO "RightsEvidenceResetArchive"
        ("sourceTable", "sourceId", "tenantOrganisationId", "archivedByUserId", "payload")
        SELECT 'RightsUsageLedgerEvent', e.id, e."organisationId", ${archiverUserId}, to_jsonb(e)
        FROM "RightsUsageLedgerEvent" AS e WHERE e."organisationId" = ${organisation.id}`;
      await db.rightsUsageLedgerEvent.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsEdgeProofEvent.deleteMany({ where: { node: { organisationId: organisation.id } } });
      await db.proofOfPlayEvent.deleteMany({ where: { organisationId: organisation.id } });
      await db.playoutIntent.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsOverride.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsAnnouncement.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsRequest.deleteMany({ where: { organisationId: organisation.id } });
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
      if (localPromo) {
        await db.promoAsset.update({ where: { id: localPromo.id }, data: { currentApprovedVersionId: null } });
        await db.promoVersion.deleteMany({ where: { promoAssetId: localPromo.id } });
        await db.promoAsset.delete({ where: { id: localPromo.id } });
      }
      for (const extraPromo of [priorityPromo, emergencyPromo]) if (extraPromo) {
        await db.promoAsset.update({ where: { id: extraPromo.id }, data: { currentApprovedVersionId: null } });
        await db.promoVersion.deleteMany({ where: { promoAssetId: extraPromo.id } });
        await db.promoAsset.delete({ where: { id: extraPromo.id } });
      }
      if (media) await db.mediaAsset.delete({ where: { id: media.id } });
      if (localMedia) await db.mediaAsset.delete({ where: { id: localMedia.id } });
      for (const extraMedia of [priorityMedia, emergencyMedia]) if (extraMedia)
        await db.mediaAsset.delete({ where: { id: extraMedia.id } });
      if (licensedMedia) await db.mediaAsset.delete({ where: { id: licensedMedia.id } });
      if (licensedGenre) await db.mediaGenre.delete({ where: { id: licensedGenre.id } });
      await db.player.deleteMany({ where: { organisationId: organisation.id } });
      await db.channelAssignment.deleteMany({ where: { channel: { organisationId: organisation.id } } });
      await db.channel.deleteMany({ where: { organisationId: organisation.id } });
      await db.station.deleteMany({ where: { organisationId: organisation.id } });
      await db.location.deleteMany({ where: { organisationId: organisation.id } });
      await db.auditLog.deleteMany({ where: { organisationId: organisation.id } });
      await db.organisationMember.deleteMany({ where: { organisationId: organisation.id } });
      await db.subscription.deleteMany({ where: { organisationId: organisation.id } });
      await db.organisation.delete({ where: { id: organisation.id } });
    }
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});
