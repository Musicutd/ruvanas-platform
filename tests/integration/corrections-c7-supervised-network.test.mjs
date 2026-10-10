import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";
import { localDateTimeParts } from "../../lib/opening-hours.mjs";
import { assertStudioRenderReady } from "../../lib/studio-product-handoff.mjs";
import { verifyEdgeManifest } from "../../lib/corrections-edge-manifest.mjs";

// This is a disposable HTTP compatibility fixture, not an audible validation.
// Only the immutable Studio output is simulated; submission, Guard review,
// syndication, targeting, private media, and signed proof use real app routes.
// The C8 bridge below verifies software signing/authorisation, not a physical
// Edge, browser playback, human audibility, or the recording/render worker.
const ciUrl = "postgresql://postgres:postgres@localhost:5432/ruvanas";
const localUrl = "postgresql://c9networklab@127.0.0.1:5550/ruvanas_c9_network_20261006";
const ciBase = "http://127.0.0.1:3100";
const localBase = "http://127.0.0.1:3188";
const databaseUrl = process.env.DATABASE_URL || "";
const baseUrl = process.env.INTEGRATION_BASE_URL || ciBase;
const ci = process.env.GITHUB_ACTIONS === "true" && databaseUrl === ciUrl && baseUrl === ciBase;
const local = process.env.C9_LOCAL_NETWORK_INTEGRATION === "fictional-20261006" &&
  databaseUrl === localUrl && baseUrl === localBase;
const mediaPort = local ? 9188 : 9107;
const bucket = local ? "c9-local-test" : "c7-test";
const cloudTestKey = createPrivateKey({ key: Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)
]), format: "der", type: "pkcs8" });
const cloudTestPublicKey = createPublicKey(cloudTestKey).export({ type: "spki", format: "pem" });
const deviceTestKey = createPrivateKey({ key: Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 8)
]), format: "der", type: "pkcs8" });
const deviceTestPublicKey = createPublicKey(deviceTestKey).export({ type: "spki", format: "pem" });

function wavTone() {
  const samples = 8000 * 30;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0, "ascii"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8, "ascii"); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii"); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 523 * i / 8000) * 7000), 44 + i * 2);
  return bytes;
}

async function api(path, { method = "GET", body, cookie, instanceId, machine, noOrigin = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(noOrigin ? {} : { origin: baseUrl }),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(machine ? { authorization: `Bearer ${machine}` } : {}),
    ...(cookie ? { cookie } : {}), ...(instanceId ? { "x-ruvanas-player-instance": instanceId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

function status(response, expected, context) {
  assert.equal(response.status, expected, `${context}: HTTP ${response.status}${response.body?.error ? ` (${response.body.error})` : ""}`);
  return response.body;
}

test("C4 Guard-supervised IN_REVIEW output reaches C7 player and C8 signed manifest only while authorised", async () => {
  if ((!ci && !local) || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C4-to-C7 HTTP integration requires the exact owned CI or local disposable database and loopback app.");
  }
  const db = new PrismaClient();
  const objects = new Map();
  const store = createServer((request, response) => {
    const path = new URL(request.url, `http://127.0.0.1:${mediaPort}`).pathname;
    const prefix = `/${bucket}/`;
    const bytes = path.startsWith(prefix) ? objects.get(decodeURIComponent(path.slice(prefix.length))) : null;
    if (request.method !== "GET" || !bytes) { response.writeHead(404); response.end(); return; }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range ? Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1) : bytes.length - 1;
    if (start > end || end >= bytes.length) { response.writeHead(416); response.end(); return; }
    response.writeHead(range ? 206 : 200, { "Content-Type": "audio/wav", "Content-Length": end - start + 1,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(bytes.subarray(start, end + 1));
  });
  const suffix = randomUUID().slice(0, 8);
  const password = `C9-fixture-${randomUUID()}!`;
  const users = [];
  let organisation, outsider, plan;
  try {
    // Fail closed before any seed write if the local URL points at another
    // PostgreSQL cluster. The caller separately verifies this cluster is fresh.
    if (local) {
      const [identity] = await db.$queryRaw`SELECT current_database() AS "database", current_user AS "role", host(inet_server_addr()) AS "host", inet_server_port() AS "port", current_setting('data_directory') AS "directory"`;
      assert.equal(identity.database, "ruvanas_c9_network_20261006");
      assert.equal(identity.role, "c9networklab");
      assert.equal(identity.host, "127.0.0.1");
      assert.equal(identity.port, 5550);
      assert.ok(identity.directory.replaceAll("\\", "/").toLowerCase().endsWith("/tmp/c9-network-compatibility-20261006/postgres"),
        "The PostgreSQL data directory must be the fresh owned C9 network lab cluster.");
    }
    await new Promise((resolve, reject) => store.once("error", reject).listen(mediaPort, "127.0.0.1", resolve));
    plan = await db.plan.create({ data: { name: `Synthetic C9 Tier 4 ${suffix}`, code: `C9_NETWORK_${suffix}`,
      productFamily: "CORRECTIONS", tierNumber: 4, publiclyAvailable: false,
      monthlyPriceCents: 49900, storageLimitGb: 10,
      listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true, stationLimit: 4 } });
    organisation = await db.organisation.create({ data: { name: `Fictional Inside authority ${suffix}`, slug: `c9-network-${suffix}` } });
    outsider = await db.organisation.create({ data: { name: `Fictional outsider ${suffix}`, slug: `c9-network-other-${suffix}` } });
    await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE" } });
    async function member(role, name) {
      const user = await db.user.create({ data: { name, email: `${name}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 4), role } });
      users.push(user);
      const membership = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role } });
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      status(login, 200, `${role} login`);
      assert.ok(login.cookie);
      return { user, membership, cookie: login.cookie };
    }
    const owner = await member("OWNER", "c9-central-owner");
    const manager = await member("MANAGER", "c9-origin-manager");
    // A separate synthetic platform administrator creates the Edge identity;
    // ordinary facility staff are not granted this platform-only capability.
    const adminUser = await db.user.create({ data: { name: "Fictional Edge administrator",
      email: `c9-edge-admin-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "SUPER_ADMIN" } });
    users.push(adminUser);
    const adminLogin = await api("/api/auth/login", { method: "POST", body: { email: adminUser.email, password } });
    status(adminLogin, 200, "separate Edge administrator login");
    assert.ok(adminLogin.cookie);
    const facilities = [];
    for (const label of ["A", "B"]) facilities.push(await db.location.create({ data: {
      organisationId: organisation.id, name: `Fictional Facility ${label}`, slug: `c9-network-${label.toLowerCase()}-${suffix}`,
      status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT",
      zones: { create: { name: "Wing 1", slug: "wing-1", status: "ACTIVE" } },
      correctionsFacility: { create: { policyConfiguredAt: new Date() } } } }));
    const foreign = await db.location.create({ data: { organisationId: outsider.id,
      name: "Fictional foreign facility", slug: `c9-foreign-${suffix}`, status: "ACTIVE", timezone: "Europe/Malta",
      countryCode: "MT", correctionsFacility: { create: { policyConfiguredAt: new Date() } } } });
    await db.correctionsProfile.create({ data: { organisationId: organisation.id, policyConfiguredAt: new Date() } });
    await db.correctionsFacilityGrant.create({ data: { organisationId: organisation.id,
      organisationMemberId: manager.membership.id, facilityId: facilities[0].id,
      permission: "MANAGER", createdByUserId: owner.user.id } });
    status(await api("/api/corrections/network/grants", { method: "PUT", cookie: owner.cookie,
      body: { memberId: manager.membership.id, canView: true, canDistribute: true } }), 200, "network grant");

    // The normal C4 Studio API creates and activates the supervised session.
    const programme = status(await api("/api/corrections/programmes", { method: "POST", cookie: manager.cookie,
      body: { facilityId: facilities[0].id, title: `Fictional supervised programme ${suffix}` } }), 201, "programme").programme;
    assert.equal((await db.correctionsProgramme.findUnique({ where: { id: programme.id } })).networkOrigin, "FACILITY");
    const contributor = status(await api("/api/corrections/contributors", { method: "POST", cookie: manager.cookie,
      body: { facilityId: facilities[0].id, displayName: "Fictional supervised contributor" } }), 201, "contributor").contributor;
    const session = status(await api("/api/corrections/studio-sessions", { method: "POST", cookie: manager.cookie,
      body: { facilityId: facilities[0].id, contributorId: contributor.id, programmeId: programme.id,
        projectType: "QUICK_RECORD" } }), 201, "supervised session").session;
    const activation = status(await api(`/api/corrections/studio-sessions/${session.id}`, { method: "POST", cookie: manager.cookie,
      body: { action: "ACTIVATE", minutes: 15 } }), 200, "session activation");
    assert.ok(activation.accessCode);
    const contributorLogin = await api("/api/corrections/contributor/session", { method: "POST",
      body: { accessCode: activation.accessCode } });
    status(contributorLogin, 200, "contributor session");
    assert.ok(contributorLogin.cookie?.startsWith("ruvanas_inside_studio="));

    // Worker-output fixture: a READY source take and a completed immutable
    // IN_REVIEW render. This does not claim the recording/render worker ran.
    const wav = wavTone();
    const checksum = createHash("sha256").update(wav).digest("hex");
    async function media(name) {
      const storageKey = `c9-network/${suffix}/${name}.wav`;
      objects.set(storageKey, wav);
      return db.mediaAsset.create({ data: { organisationId: organisation.id,
        libraryType: "ORGANISATION_PROMO", name, originalName: `${name}.wav`, storageKey,
        mimeType: "audio/wav", sizeBytes: BigInt(wav.length), durationSeconds: 30,
        mediaType: "ANNOUNCEMENT", status: "READY" } });
    }
    const source = await media("source");
    const take = await db.audioTake.create({ data: { organisationId: organisation.id, projectId: session.projectId,
      mediaAssetId: source.id, recordedByUserId: manager.user.id, durationMs: 30000,
      status: "READY", sourceEditDecision: {} } });
    const version = await db.audioProjectVersion.create({ data: { projectId: session.projectId, version: 2,
      state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: source.id }] } },
      createdByUserId: manager.user.id } });
    await db.audioProject.update({ where: { id: session.projectId }, data: { currentVersion: 2, status: "READY" } });
    const output = await media("immutable-output");
    const promo = await db.promoAsset.create({ data: { organisationId: organisation.id,
      name: "Fictional submitted output", mediaType: "ANNOUNCEMENT" } });
    const render = await db.audioRender.create({ data: { organisationId: organisation.id, projectId: session.projectId,
      versionId: version.id, outputMediaAssetId: output.id, requestedByUserId: manager.user.id,
      preset: "SPEECH_MP3", status: "SUCCEEDED", completedAt: new Date(),
      resultJson: { immutableSource: true, checksumSha256: checksum } } });
    const promoVersion = await db.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: output.id,
      version: 1, status: "IN_REVIEW", qcStatus: "PASSED", sourceType: "STUDIO",
      sourceReference: `audio-render:${render.id}`, checksumSha256: checksum } });
    await db.audioRender.update({ where: { id: render.id }, data: { outputPromoVersionId: promoVersion.id } });
    assert.throws(() => assertStudioRenderReady({ status: "SUCCEEDED", outputMediaAsset: output,
      outputPromoVersion: promoVersion }), /Approve the final Studio output/,
    "ordinary six-product handoff still requires an APPROVED Studio output");

    const submitted = status(await api("/api/corrections/contributor/submit", { method: "POST",
      cookie: contributorLogin.cookie, body: { renderId: render.id } }), 200, "contributor submission").submission;
    assert.equal(submitted.status, "SUBMITTED");
    const pinned = await db.correctionsSubmission.findUnique({ where: { id: submitted.id } });
    assert.equal(pinned.studioSessionId, session.id);
    assert.equal(pinned.studioProjectId, session.projectId);
    assert.equal(pinned.studioVersionId, version.id);
    assert.equal(pinned.renderId, render.id);
    assert.equal(pinned.contributorId, contributor.id);
    assert.equal(pinned.evidenceSnapshot.sourceKind, "SUPERVISED_STUDIO_PENDING_REVIEW");
    assert.equal((await db.correctionsStudioSession.findUnique({ where: { id: session.id } })).status, "SUBMITTED");
    const target = facilities[1].id;
    const distributeBody = { programmeId: programme.id, facilityIds: [target] };
    assert.equal((await api("/api/corrections/network/syndication", { method: "POST", cookie: manager.cookie,
      body: { programmeId: programme.id } })).status, 409, "pending Guard may not be offered");
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: distributeBody })).status, 409, "pending Guard may not distribute");
    assert.equal((await api(`/api/corrections/programmes/${programme.id}/review`, { method: "POST",
      cookie: contributorLogin.cookie, body: { stage: "STAFF", decision: "APPROVE" } })).status, 401,
    "contributor capability cannot review its own output");
    assert.equal((await api(`/api/corrections/programmes/${programme.id}/review`, { method: "POST",
      cookie: manager.cookie, body: { stage: "STAFF", decision: "APPROVE" } })).status, 409,
    "the accountable supervisor cannot self-approve");
    status(await api(`/api/corrections/programmes/${programme.id}/review`, { method: "POST", cookie: owner.cookie,
      body: { stage: "STAFF", decision: "APPROVE", note: "Independent fictional fixture approval" } }), 201, "independent Guard approval");
    assert.equal((await db.correctionsSubmission.findUnique({ where: { id: submitted.id } })).status, "APPROVED");
    assert.equal((await db.promoVersion.findUnique({ where: { id: promoVersion.id } })).status, "IN_REVIEW",
      "Guard approval does not silently approve an ordinary Studio handoff");
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: distributeBody })).status, 409, "facility-origin content still requires accepted offer");
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: contributorLogin.cookie,
      body: distributeBody })).status, 401, "contributor cannot distribute");
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: { programmeId: programme.id, facilityIds: [foreign.id] } })).status, 400,
    "foreign organisation facility cannot be targeted");
    const offered = status(await api("/api/corrections/network/syndication", { method: "POST", cookie: manager.cookie,
      body: { programmeId: programme.id } }), 201, "facility offer");
    assert.equal((await api(`/api/corrections/network/syndication/${offered.id}`, { method: "PATCH", cookie: manager.cookie,
      body: { decision: "ACCEPTED" } })).status, 403, "offering staff cannot self-accept");
    status(await api(`/api/corrections/network/syndication/${offered.id}`, { method: "PATCH", cookie: owner.cookie,
      body: { decision: "ACCEPTED" } }), 200, "independent central acceptance");
    const distribution = status(await api("/api/corrections/network/distribution", { method: "POST", cookie: owner.cookie,
      body: { ...distributeBody, syndicationOfferId: offered.id } }), 201, "explicit distribution");
    assert.deepEqual(distribution.targetFacilityIds, [target]);
    const distributionId = distribution.distributionIds[0];
    status(await api("/api/corrections/network/windows", { method: "POST", cookie: owner.cookie,
      body: { facilityId: target, kind: "CENTRAL", distributionId,
        weekday: localDateTimeParts(new Date(), "Europe/Malta").weekday,
        startMinute: 0, endMinute: 1440, mandatory: true, allowedContentTypes: ["PROGRAMME"] } }), 201, "central window");

    const zone = await db.zone.findFirstOrThrow({ where: { locationId: target } });
    const station = await db.station.create({ data: { organisationId: organisation.id,
      productFamily: "CORRECTIONS", name: "Fictional private station", slug: `c9-station-${suffix}`,
      status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128 } });
    const channel = await db.channel.create({ data: { organisationId: organisation.id, stationId: station.id,
      name: "Fictional private channel", slug: `c9-channel-${suffix}`, status: "ACTIVE",
      musicRightsUse: "CORRECTIONS_RADIO" } });
    await db.channelAssignment.create({ data: { channelId: channel.id, zoneId: zone.id,
      activeFrom: new Date(Date.now() - 60_000) } });
    const playerToken = `c9-fictional-${randomUUID()}`;
    const player = await db.player.create({ data: { organisationId: organisation.id, zoneId: zone.id,
      name: "Fictional B player", status: "ONLINE", sessionTokenHash: hashPlayerToken(playerToken, process.env.SESSION_SECRET),
      enrolledAt: new Date(), lastHeartbeatAt: new Date() } });
    const playerCookie = `ruvanas_player=${playerToken}`;
    const instanceId = randomUUID();
    const manifest = () => api("/api/player/manifest", { cookie: playerCookie, instanceId });
    const current = status(await manifest(), 200, "private B manifest");
    const insertion = current.insertions.find((item) => item.programmingSource === "CORRECTIONS_SYNDICATED");
    assert.ok(insertion, "B receives only the explicitly accepted, approved, pinned private source");
    assert.equal(insertion.title, programme.title);
    assert.equal((await db.correctionsProgrammeDistribution.findUnique({ where: { id: distributionId } })).submissionId, submitted.id);
    const mediaResponse = await fetch(new URL(insertion.mediaUrl, baseUrl), { headers: { cookie: playerCookie,
      range: "bytes=0-16043" } });
    assert.equal(mediaResponse.status, 206, "private media must be fetched through protected player route");
    const fetched = Buffer.from(await mediaResponse.arrayBuffer());
    assert.equal(fetched.toString("ascii", 0, 4), "RIFF");
    assert.deepEqual(fetched, wav.subarray(0, 16044));
    // Exercise the real C8 adapter against the exact C4-supervised submission,
    // without globally approving the ordinary Studio promo or starting an Edge.
    const createdEdge = status(await api("/api/admin/corrections/edge", { method: "POST", cookie: adminLogin.cookie,
      body: { organisationId: organisation.id, facilityId: target, name: "Fictional supervised-output Edge" } }),
    201, "synthetic target Edge identity");
    const enrolledEdge = status(await api("/api/corrections/edge/enrol", { method: "POST", noOrigin: true,
      machine: createdEdge.enrolmentCredential, body: { enrolmentCredential: createdEdge.enrolmentCredential,
        proofPublicKeyPem: deviceTestPublicKey } }), 200, "synthetic target Edge enrolment");
    const edgeScope = { nodeId: createdEdge.nodeId, organisationId: organisation.id, facilityId: target };
    async function edgeManifest(context) {
      const signed = status(await api("/api/corrections/edge/manifest", { machine: enrolledEdge.machineCredential }),
        200, context);
      assert.equal(verifyEdgeManifest(signed, cloudTestPublicKey, edgeScope), true,
        `${context}: real C8 signature and exact scope must verify`);
      assert.equal(verifyEdgeManifest(signed, deviceTestPublicKey, edgeScope), false,
        `${context}: the device proof identity cannot impersonate the cloud signer`);
      return signed;
    }
    const signed = await edgeManifest("supervised C8 manifest");
    assert.equal(signed.payload.content.length, 1);
    assert.deepEqual(signed.payload.content[0], { mediaAssetId: output.id, promoVersionId: promoVersion.id,
      sha256: checksum, sizeBytes: wav.length, mimeType: "audio/wav", durationSeconds: 30,
      rightsUse: "CORRECTIONS_RADIO", sourceType: "PROGRAMME" });
    assert.equal(signed.payload.windows.length, 1);
    const signedWindow = signed.payload.windows[0];
    assert.equal(signedWindow.facilityId, target);
    assert.equal(signedWindow.distributionId, distributionId);
    assert.equal(signedWindow.programmingSource, "CORRECTIONS_SYNDICATED");
    assert.equal(signedWindow.contentKey, `${output.id}:${promoVersion.id}:${checksum}`);
    assert.equal(signedWindow.sourceRevision,
      `c7:${signedWindow.id}:${distributionId}:${submitted.id}:${pinned.sourceFingerprint}`);
    assert.equal(verifyEdgeManifest(signed, cloudTestPublicKey, { ...edgeScope, facilityId: facilities[0].id }), false,
      "the target B envelope cannot be relabelled as facility A");
    assert.equal((await db.promoVersion.findUnique({ where: { id: promoVersion.id } })).status, "IN_REVIEW",
      "C8 must use Guard approval, not silently grant an ordinary Studio approval");
    const edgeMediaUrl = `${baseUrl}/api/corrections/edge/media/${output.id}`;
    const edgeHeaders = { authorization: `Bearer ${enrolledEdge.machineCredential}` };
    const edgeMedia = await fetch(edgeMediaUrl, { headers: edgeHeaders });
    assert.equal(edgeMedia.status, 200, "the enrolled Edge can fetch only its authorised immutable output");
    assert.deepEqual(Buffer.from(await edgeMedia.arrayBuffer()), wav);
    assert.equal((await fetch(edgeMediaUrl)).status, 401, "Edge media is not public");
    const event = { eventId: randomUUID(), manifestVersion: current.version, proofToken: insertion.proofToken,
      programmingSourceProofToken: insertion.programmingSourceProofToken, scheduleItemId: insertion.scheduleItemId,
      itemType: "CORRECTIONS_AUDIO", programmingSource: "CORRECTIONS_SYNDICATED", eventType: "COMPLETED",
      occurredAt: new Date().toISOString(), positionSeconds: 30 };
    assert.equal(await db.proofOfPlayEvent.count({ where: { organisationId: organisation.id } }), 0,
      "no delivery is claimed before player evidence");
    const proof = status(await api("/api/player/proof-of-play", { method: "POST", cookie: playerCookie,
      instanceId, body: { events: [event] } }), 200, "synthetic signed proof");
    assert.equal(proof.accepted, 1);
    assert.equal(await db.proofOfPlayEvent.count({ where: { organisationId: organisation.id } }), 1);

    // Source revocation and historical-binding tampering fail closed at
    // playback. Restore only this disposable fixture's own rows after each.
    await db.audioTake.update({ where: { id: take.id }, data: { trashedAt: new Date() } });
    assert.equal((await fetch(edgeMediaUrl, { headers: edgeHeaders })).status, 403,
      "C8 rechecks revoked source before a new manifest is requested");
    assert.equal((await edgeManifest("trashed-source C8 manifest")).payload.content.length, 0);
    assert.ok(!(status(await manifest(), 200, "trashed-source manifest").insertions || []).some((item) =>
      item.programmingSource === "CORRECTIONS_SYNDICATED"));
    await db.audioTake.update({ where: { id: take.id }, data: { trashedAt: null } });
    await db.correctionsSubmission.update({ where: { id: submitted.id }, data: { sourceFingerprint: "f".repeat(64) } });
    assert.equal((await edgeManifest("tampered-fingerprint C8 manifest")).payload.content.length, 0);
    assert.ok(!(status(await manifest(), 200, "tampered-fingerprint manifest").insertions || []).some((item) =>
      item.programmingSource === "CORRECTIONS_SYNDICATED"));
    await db.correctionsSubmission.update({ where: { id: submitted.id }, data: { sourceFingerprint: pinned.sourceFingerprint } });
    await db.correctionsSubmission.update({ where: { id: submitted.id }, data: { studioSessionId: null } });
    assert.equal((await edgeManifest("lost-session-link C8 manifest")).payload.content.length, 0);
    assert.ok(!(status(await manifest(), 200, "lost-session-link manifest").insertions || []).some((item) =>
      item.programmingSource === "CORRECTIONS_SYNDICATED"));
    await db.correctionsSubmission.update({ where: { id: submitted.id }, data: { studioSessionId: session.id } });
    const restoredEdge = await edgeManifest("restored supervised C8 manifest");
    assert.deepEqual(restoredEdge.payload.content, signed.payload.content);
    assert.ok(restoredEdge.payload.sequence > signed.payload.sequence, "revocation and restoration advance the signed sequence");
    assert.ok(status(await manifest(), 200, "restored private manifest").insertions.some((item) =>
      item.programmingSource === "CORRECTIONS_SYNDICATED"));

    status(await api(`/api/corrections/network/distribution/${distributionId}`, { method: "DELETE", cookie: owner.cookie }),
      200, "distribution withdrawal");
    assert.equal((await fetch(edgeMediaUrl, { headers: edgeHeaders })).status, 403,
      "withdrawal denies an old signed media entitlement before resync");
    const withdrawnEdge = await edgeManifest("withdrawn supervised C8 manifest");
    assert.deepEqual(withdrawnEdge.payload.content, []);
    assert.deepEqual(withdrawnEdge.payload.windows, []);
    assert.equal((await fetch(edgeMediaUrl, { headers: edgeHeaders })).status, 404,
      "after resync the old media is absent from the current signed manifest");
    assert.ok(!(status(await manifest(), 200, "withdrawn private manifest").insertions || []).some((item) =>
      item.programmingSource === "CORRECTIONS_SYNDICATED"));
    assert.equal((await fetch(new URL(insertion.mediaUrl, baseUrl), { headers: { cookie: playerCookie } })).status, 404,
      "withdrawn media URL cannot play");
    const lateProof = await api("/api/player/proof-of-play", { method: "POST", cookie: playerCookie,
      instanceId, body: { events: [{ ...event, eventId: randomUUID() }] } });
    assert.equal(lateProof.status, 400, "withdrawn distribution cannot produce false completed delivery");
    assert.equal(await db.proofOfPlayEvent.count({ where: { organisationId: organisation.id } }), 1,
      "historical evidence remains, but no new completion is counted");
    assert.ok(player.id);
  } finally {
    if (store.listening) await new Promise((resolve) => store.close(resolve));
    if (organisation) {
      await db.correctionsEdgeProofEvent.deleteMany({ where: { node: { organisationId: organisation.id } } });
      await db.correctionsEdgeNode.deleteMany({ where: { organisationId: organisation.id } });
      await db.rightsUsageLedgerEvent.deleteMany({ where: { organisationId: organisation.id } });
      await db.proofOfPlayEvent.deleteMany({ where: { organisationId: organisation.id } });
      await db.playoutIntent.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsNetworkWindow.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsProgrammeDistribution.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsSyndicationOffer.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsReview.deleteMany({ where: { submission: { organisationId: organisation.id } } });
      await db.correctionsSubmission.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsStudioSession.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsContributor.deleteMany({ where: { organisationId: organisation.id } });
      await db.correctionsProgramme.deleteMany({ where: { organisationId: organisation.id } });
      await db.audioTake.deleteMany({ where: { organisationId: organisation.id } });
      await db.audioRender.deleteMany({ where: { organisationId: organisation.id } });
      await db.audioProjectVersion.deleteMany({ where: { project: { organisationId: organisation.id } } });
      await db.audioProject.deleteMany({ where: { organisationId: organisation.id } });
      await db.promoAsset.updateMany({ where: { organisationId: organisation.id }, data: { currentApprovedVersionId: null } });
      await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId: organisation.id } } });
      await db.promoAsset.deleteMany({ where: { organisationId: organisation.id } });
      await db.mediaAsset.deleteMany({ where: { organisationId: organisation.id } });
      await db.playerListenerLease.deleteMany({ where: { organisationId: organisation.id } });
      await db.player.deleteMany({ where: { organisationId: organisation.id } });
      await db.channelAssignment.deleteMany({ where: { channel: { organisationId: organisation.id } } });
      await db.channel.deleteMany({ where: { organisationId: organisation.id } });
      await db.station.deleteMany({ where: { organisationId: organisation.id } });
      await db.notificationEvent.deleteMany({ where: { organisationId: organisation.id } });
      await db.auditLog.deleteMany({ where: { organisationId: organisation.id } });
      await db.organisation.delete({ where: { id: organisation.id } });
    }
    if (outsider) await db.organisation.delete({ where: { id: outsider.id } });
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});
