import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { correctionsFacilityPermission } from "../../lib/corrections-policy.mjs";
import { correctionsProgrammePermission, correctionsRenderEvidence, correctionsContributorRenderEvidence,
  correctionsReviewTransition, correctionsSchedulingGate } from "../../lib/corrections-workflow.mjs";
import { CORRECTIONS_STUDIO_CAPABILITIES, correctionsStudioCan } from "../../lib/corrections-studio-policy.mjs";
import { correctionsRequestTransition } from "../../lib/corrections-c5-policy.mjs";
import { createPlaybackProofToken, verifyPlaybackProofToken } from "../../lib/playback-proof.mjs";
import { signEdgeManifest, verifyEdgeManifest } from "../../lib/corrections-edge-manifest.mjs";
import { signCorrectionsEdgeProof, verifyCorrectionsEdgeProof, validCorrectionsEdgeProofPayload } from "../../lib/corrections-edge-proof.mjs";
import { createEdgeCredential, hashEdgeCredential, edgeNodeIsUsable } from "../../lib/corrections-edge-identity.mjs";
import { resolveCorrectionsEdgePlayback } from "../../edge/resolver.mjs";
import { localDateTimeParts } from "../../lib/opening-hours.mjs";
import { countCorrectionsPrivacyInventory } from "../../lib/corrections-privacy-inventory.mjs";
import { recoveryContainerAddress, assertRecoveryDatabaseUrl } from "../../lib/corrections-recovery-rehearsal-safety.mjs";

const SOURCE = "ruvanas_c9_recovery_source";
const TARGET = "ruvanas_c9_recovery_target";
const PREFIX = "fictional-c9-recovery-";
const TIME = new Date("2026-01-02T10:00:00.000Z");
const PROOF_SECRET = "fictional-recovery-proof-secret-ci-only-2026";
const EDGE_CREDENTIAL_SECRET = "fictional-recovery-edge-secret-ci-only-2026";
const EDGE_NODE_A = "c8recoveryedgea000000000001";
const EDGE_NODE_B = "c8recoveryedgeb000000000001";
const MODELS = ["plan", "organisation", "subscription", "organisationMediaProfile", "user", "organisationMember", "location", "zone",
  "correctionsProfile", "correctionsFacility", "correctionsFacilityGrant", "station", "channel", "channelAssignment",
  "player", "correctionsProgramme", "correctionsContributor", "audioProject", "audioProjectVersion", "mediaAsset",
  "promoAsset", "promoVersion", "audioTake", "audioRender", "correctionsStudioSession", "correctionsSubmission",
  "correctionsReview", "correctionsRequest", "correctionsRequestDecision", "correctionsProgrammeDistribution", "correctionsNetworkWindow",
  "correctionsEdgeNode", "correctionsEdgeManifest", "correctionsEdgeProofEvent", "playoutIntent", "proofOfPlayEvent", "auditLog"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const RECOVERY_MANIFEST_VERSION = sha256("fictional-recovery-manifest-1").slice(0, 24);
const id = (name) => `${PREFIX}${name}`;
const at = (seconds) => new Date(TIME.getTime() + seconds * 1000);
// migrate deploy itself inserts these public plans and QA configuration rows.
// An otherwise empty database must retain this exact, harmless baseline.
const MIGRATION_BASELINE = {
  plan: ["retail-start", "retail-business", "retail-professional", "retail-advanced", "retail-enterprise", "school-start", "school-create", "school-pro", "school-academy", "school-enterprise",
    "online-hobby", "online-starter", "online-professional", "online-station-pro", "online-network", "health-start", "health-connect", "health-pro", "health-network", "health-enterprise",
    "faith-start", "faith-connect", "faith-pro", "faith-ministry", "faith-network", "organisations-start", "organisations-connect", "organisations-pro", "organisations-network", "organisations-enterprise",
    "corrections-essential", "corrections-facility", "corrections-rehabilitation-pro", "corrections-network", "corrections-justice-enterprise"].map((name) => `public-plan-${name}`),
  organisation: ["qa-health-organisation", "qa-faith-organisation", "qa-organisations-organisation"],
  subscription: ["qa-health-subscription", "qa-faith-subscription", "qa-organisations-subscription"],
  organisationMediaProfile: ["qa-organisations-media-profile"]
};
// Only fixed fixture operations/model names and a bounded Prisma code reach CI.
// Never preserve the original error message, metadata, query or connection URL.
async function fixtureOperation(operation, model, work) {
  try { return await work(); } catch (error) {
    if (error?.fixtureDiagnostic === true) throw error;
    const prismaCode = /^P\d{4}$/.test(error?.code || "") ? error.code : null;
    const reason = ({ P2002: "UNIQUE_CONSTRAINT", P2003: "FOREIGN_KEY", P2004: "DATABASE_CONSTRAINT", P2021: "TABLE_MISSING", P2022: "COLUMN_MISSING", P2028: "TRANSACTION_FAILED" })[prismaCode]
      || (error?.code === "ERR_ASSERTION" ? "ASSERTION_FAILED" : error?.name === "PrismaClientValidationError" ? "CLIENT_VALIDATION_FAILED" : "DEPENDENCY_FAILED");
    console.error(JSON.stringify({ event: "RECOVERY_FIXTURE_FAILURE", operation, model, prismaCode }));
    const failure = new Error(`RECOVERY_REHEARSAL_FIXTURE_${operation}_${model ? model.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase() : "NONE"}_${reason}`);
    failure.fixtureDiagnostic = true;
    throw failure;
  }
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return String(value);
  if (value?.toJSON) return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
async function databaseName(db) {
  const rows = await db.$queryRaw`SELECT current_database() AS name`;
  return rows[0].name;
}
async function assertPublicPlanCatalogue(db) {
  const plans = await db.plan.findMany();
  assert.equal(plans.length, 35, "Migration catalogue must retain exactly 35 public plans.");
  const families = ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS", "CORRECTIONS"];
  for (const family of families) {
    const group = plans.filter((plan) => plan.productFamily === family && plan.publiclyAvailable === true);
    assert.deepEqual(group.map((plan) => plan.tierNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5], `${family} must retain all five migrated public tiers.`);
  }
}
async function digests(db) {
  return Object.fromEntries(await Promise.all(MODELS.map(async (model) => [model,
    (await db[model].findMany()).map((row) => ({ id: row.id || row.organisationId || row.locationId,
      sha256: sha256(JSON.stringify(canonical(row))) })).sort((a, b) => a.id.localeCompare(b.id))])));
}
function syntheticWav(marker) {
  const wav = Buffer.alloc(44 + 32_000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(16_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(32_000, 40); wav.writeInt16LE(marker, 44);
  return wav;
}

// All content is fictional. Bytes are returned for a local archive rehearsal;
// this fixture neither uploads objects nor claims to test an external store.
export async function seedCorrectionsRecoveryFixture(db, { sourceDatabaseUrl, container, ownership, network, password } = {}) {
  await fixtureOperation("SOURCE_GUARD", null, async () => {
    assert.equal(process.env.GITHUB_ACTIONS, "true", "Recovery fixture requires disposable GitHub Actions infrastructure.");
    assert.equal(process.env.C9_RECOVERY_REHEARSAL, "true", "Recovery fixture requires the explicit rehearsal flag.");
    const host = recoveryContainerAddress(container, ownership, network);
    assertRecoveryDatabaseUrl(sourceDatabaseUrl, { host, port: 5432, password, database: SOURCE });
    assert.equal(await databaseName(db), SOURCE, "Connected database must be the dedicated source.");
  });
  for (const model of MODELS) await fixtureOperation("BASELINE_COUNT", model, async () => assert.equal(await db[model].count(MIGRATION_BASELINE[model]
    ? { where: { id: { notIn: MIGRATION_BASELINE[model] } } } : undefined), 0, `Source ${model} table must contain only migration baseline rows.`));
  await fixtureOperation("PUBLIC_PLAN_CATALOGUE", "plan", () => assertPublicPlanCatalogue(db));
  const ids = {}, media = [];
  // Independent, ephemeral CI-only keys. Only public keys and signatures enter
  // the recovered database/expected evidence; no private key enters the dump.
  const cloudKeys = generateKeyPairSync("ed25519");
  const proofKeysA = generateKeyPairSync("ed25519");
  const proofKeysB = generateKeyPairSync("ed25519");
  const publicPem = (keys) => keys.publicKey.export({ type: "spki", format: "pem" });
  const privatePem = (keys) => keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const cloudPublicKeyPem = publicPem(cloudKeys);
  await fixtureOperation("TRANSACTION", null, () => db.$transaction(async (tx) => {
    const make = async (model, label, data) => {
      ids[label] = id(label);
      return fixtureOperation("CREATE", model, () => tx[model].create({ data: { id: ids[label], ...data } }));
    };
    ids.plan = "public-plan-corrections-network";
    const plan = await fixtureOperation("NETWORK_PLAN_LOOKUP", "plan", async () => {
      const row = await tx.plan.findUnique({ where: { id: ids.plan } });
      assert.ok(row && row.code === "CORRECTIONS_NETWORK" && row.productFamily === "CORRECTIONS" && row.tierNumber === 4 && row.correctionsRadioEnabled === true,
        "The fixture must use the existing migrated Inside Network plan.");
      return row;
    });
    for (const tenant of ["a", "b"]) {
      await make("organisation", `org-${tenant}`, { name: `Fictional organisation ${tenant}`, slug: id(`org-${tenant}`) });
      await make("subscription", `subscription-${tenant}`, { organisationId: ids[`org-${tenant}`], planId: plan.id, status: "ACTIVE" });
      await fixtureOperation("CREATE", "correctionsProfile", () => tx.correctionsProfile.create({ data: { organisationId: ids[`org-${tenant}`], policyConfiguredAt: TIME } }));
    }
    for (const [label, role, tenant] of [["owner-a", "OWNER", "a"], ["manager-a", "MANAGER", "a"], ["reviewer-a", "MANAGER", "a"], ["owner-b", "OWNER", "b"]]) {
      await make("user", label, { name: `Fictional ${label}`, email: `${label}@recovery.example.invalid`, passwordHash: "ci-only-unusable", role });
      await make("organisationMember", `member-${label}`, { userId: ids[label], organisationId: ids[`org-${tenant}`], role });
    }
    for (const [label, tenant] of [["facility-a", "a"], ["facility-a-other", "a"], ["facility-b", "b"]]) {
      await make("location", label, { organisationId: ids[`org-${tenant}`], name: `Fictional ${label}`, slug: label,
        status: "ACTIVE", countryCode: "MT", timezone: "Europe/Malta" });
      await fixtureOperation("CREATE", "correctionsFacility", () => tx.correctionsFacility.create({ data: { locationId: ids[label], policyConfiguredAt: TIME, dualApprovalRequired: true, requestAvailability: "INTERNAL_ONLY" } }));
      await make("zone", `zone-${label}`, { locationId: ids[label], name: `Fictional ${label} zone`, slug: "private-zone" });
    }
    for (const label of ["manager-a", "reviewer-a"]) await make("correctionsFacilityGrant", `grant-${label}`, {
      organisationId: ids["org-a"], organisationMemberId: ids[`member-${label}`], facilityId: ids["facility-a"], permission: "MANAGER", createdByUserId: ids["owner-a"] });
    const scope = { organisationId: ids["org-a"], facilityId: ids["facility-a"] };
    const station = await make("station", "station", { organisationId: scope.organisationId, productFamily: "CORRECTIONS", name: "Fictional private station",
      slug: id("station"), status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128 });
    await make("channel", "channel", { organisationId: scope.organisationId, stationId: station.id, name: "Fictional private channel", slug: "private", status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO" });
    await make("channelAssignment", "assignment", { channelId: ids.channel, zoneId: ids["zone-facility-a"], activeFrom: TIME });
    await make("player", "player", { organisationId: scope.organisationId, zoneId: ids["zone-facility-a"], name: "Fictional player", status: "ONLINE", sessionTokenHash: sha256("fictional-ci-player"), enrolledAt: TIME });
    await make("correctionsProgramme", "programme", { ...scope, title: "Fictional reviewed programme", status: "APPROVED", latestRevision: 2, createdByUserId: ids["manager-a"] });
    await make("correctionsProgramme", "other-programme", { organisationId: ids["org-b"], facilityId: ids["facility-b"], title: "Fictional other tenant programme", createdByUserId: ids["owner-b"] });
    await make("correctionsContributor", "contributor", { ...scope, displayName: "Fictional contributor", localReference: "CI-FICTIONAL-01", createdByUserId: ids["manager-a"] });
    await make("audioProject", "project", { organisationId: scope.organisationId, title: "Fictional supervised project", currentVersion: 2, editDecision: { takeId: id("take"), trimMs: [0, 2000] }, createdByUserId: ids["manager-a"] });
    for (const [index, label] of ["take-media", "render-media-1", "render-media-2"].entries()) {
      const bytes = syntheticWav(index), storageKey = `fictional-c9-recovery/${label}.wav`;
      await make("mediaAsset", label, { organisationId: scope.organisationId, name: `Fictional ${label}`, originalName: `${label}.wav`, storageKey,
        mimeType: "audio/wav", sizeBytes: BigInt(bytes.length), durationSeconds: 2, mediaType: "VOICEOVER", status: "READY" });
      media.push({ mediaAssetId: ids[label], storageKey, checksumSha256: sha256(bytes), sizeBytes: bytes.length, bytesBase64: bytes.toString("base64") });
    }
    await make("audioTake", "take", { organisationId: scope.organisationId, projectId: ids.project, mediaAssetId: ids["take-media"], recordedByUserId: ids["manager-a"],
      durationMs: 2000, status: "READY", waveformStatus: "READY", waveformPeaks: [0, 0], waveformGeneratedAt: TIME, sourceEditDecision: { synthetic: true } });
    await make("correctionsStudioSession", "session", { ...scope, contributorId: ids.contributor, programmeId: ids.programme, projectId: ids.project,
      supervisorUserId: ids["manager-a"], createdByUserId: ids["manager-a"], status: "SUBMITTED", accessTokenHash: sha256("fictional-ci-session"),
      capabilityScope: [...CORRECTIONS_STUDIO_CAPABILITIES], activatedAt: TIME, expiresAt: at(3600), completedAt: at(40) });
    for (const revision of [1, 2]) {
      await make("audioProjectVersion", `version-${revision}`, { projectId: ids.project, version: revision, state: { takeId: ids.take, mediaAssetId: ids["take-media"], trimMs: [revision - 1, 2000] }, reason: "Fictional retained edit", createdByUserId: ids["manager-a"] });
      await make("promoAsset", `promo-${revision}`, { organisationId: scope.organisationId, name: `Fictional render ${revision}`, mediaType: "VOICEOVER" });
      await make("promoVersion", `promo-version-${revision}`, { promoAssetId: ids[`promo-${revision}`], mediaAssetId: ids[`render-media-${revision}`], version: 1,
        status: revision === 1 ? "APPROVED" : "IN_REVIEW", qcStatus: "PASSED", checksumSha256: media[revision].checksumSha256,
        sourceReference: `audio-render:${id(`render-${revision}`)}`, durationSeconds: 2 });
      await make("audioRender", `render-${revision}`, { organisationId: scope.organisationId, projectId: ids.project, versionId: ids[`version-${revision}`],
        outputMediaAssetId: ids[`render-media-${revision}`], outputPromoVersionId: ids[`promo-version-${revision}`], requestedByUserId: ids["manager-a"], preset: "WAV_MASTER",
        status: "SUCCEEDED", completedAt: at(revision * 10), resultJson: { immutableSource: true, checksumSha256: media[revision].checksumSha256 } });
      const render = await fixtureOperation("LOOKUP", "audioRender", () => tx.audioRender.findUnique({ where: { id: ids[`render-${revision}`] }, include: { outputMediaAsset: true, outputPromoVersion: true } }));
      const evidence = await fixtureOperation(revision === 1 ? "LEGACY_RENDER_EVIDENCE" : "CONTRIBUTOR_RENDER_EVIDENCE", "audioRender", () => revision === 1 ? correctionsRenderEvidence(render) : correctionsContributorRenderEvidence(render, {
        organisationId: scope.organisationId, projectId: ids.project, versionId: ids[`version-${revision}`] }));
      await make("correctionsSubmission", `submission-${revision}`, { ...scope, programmeId: ids.programme, revision, renderId: render.id,
        sourceFingerprint: evidence.fingerprint, organisationPolicyVersion: 1, facilityPolicyVersion: 1, dualApprovalRequired: true,
        status: revision === 1 ? "CHANGES_REQUESTED" : "APPROVED", titleSnapshot: "Fictional reviewed programme", submittedByUserId: ids["manager-a"], submittedAt: at(revision * 10 + 1),
        evidenceSnapshot: { ...evidence, ...(revision === 2 ? { sourceKind: "SUPERVISED_STUDIO_PENDING_REVIEW" } : {}) },
        ...(revision === 2 ? { contributorId: ids.contributor, studioSessionId: ids.session, studioProjectId: ids.project, studioVersionId: ids["version-2"] } : {}) });
    }
    for (const [label, revision, stage, decision, reviewer] of [["review-old", 1, "STAFF", "CHANGES_REQUESTED", "owner-a"], ["review-staff", 2, "STAFF", "APPROVE", "owner-a"], ["review-facility", 2, "FACILITY", "APPROVE", "reviewer-a"]])
      await make("correctionsReview", label, { submissionId: ids[`submission-${revision}`], stage, decision, note: "Fictional recovery review history", evidenceSnapshot: { synthetic: true, revision }, reviewedByUserId: ids[reviewer], reviewedAt: at(30 + revision) });
    for (const [label, status] of [["request-pending", "SCHEDULED"], ["request-delivered", "PLAYED"]]) {
      await make("correctionsRequest", label, { ...scope, source: "INTERNAL", type: "PROGRAMME", status, programmeId: ids.programme, songTitle: "Fictional programme request", originalMessage: "Fictional staff-only wording", createdByUserId: ids["manager-a"] });
      for (const [action, fromStatus, toStatus] of [["SCREEN", "RECEIVED", "SCREENING"], ["APPROVE", "SCREENING", "APPROVED"], ["SCHEDULE", "APPROVED", "SCHEDULED"]])
        await make("correctionsRequestDecision", `${label}-${action}`, { ...scope, requestId: ids[label], action, fromStatus, toStatus, moderatorUserId: ids["manager-a"], programmeId: ids.programme, decidedAt: at(40) });
      await make("playoutIntent", `intent-${label}`, { organisationId: scope.organisationId, scheduleItemId: sha256(label), playerId: ids.player, zoneId: ids["zone-facility-a"],
        channelId: ids.channel, mediaAssetId: ids["render-media-2"], promoVersionId: ids["promo-version-2"], locationId: scope.facilityId,
        locationName: "Fictional facility-a", locationTimezone: "Europe/Malta", locationGroups: [], publicationRevision: 2,
        sourceRevision: `${ids["submission-2"]}:${(await fixtureOperation("LOOKUP", "correctionsSubmission", () => tx.correctionsSubmission.findUnique({ where: { id: ids["submission-2"] } }))).sourceFingerprint}`,
        plannedStart: at(label === "request-pending" ? 100 : 200), expiresAt: at(label === "request-pending" ? 192 : 292),
        correctionsRequestId: ids[label], correctionsProgrammeId: ids.programme, correctionsSubmissionId: ids["submission-2"] });
    }
    for (const [label, request, eventType] of [["proof-failed", "request-pending", "FAILED"], ["proof-completed", "request-delivered", "COMPLETED"]])
      await make("proofOfPlayEvent", label, { organisationId: scope.organisationId, clientEventId: id(`client-${label}`), playerId: ids.player, zoneId: ids["zone-facility-a"],
        scheduleItemId: sha256(request), itemType: "CORRECTIONS_AUDIO", playoutIntentId: ids[`intent-${request}`], channelId: ids.channel,
        mediaAssetId: ids["render-media-2"], promoVersionId: ids["promo-version-2"], manifestVersion: RECOVERY_MANIFEST_VERSION, programmingSource: "CORRECTIONS_REQUEST",
        eventType, occurredAt: at(request === "request-pending" ? 101 : 202), positionSeconds: eventType === "COMPLETED" ? 2 : 0,
        playerName: "Fictional player", locationName: "Fictional facility-a", zoneName: "Fictional facility-a zone", trackTitle: "Fictional approved programme", trackArtist: "Fictional contributor" });
    for (const [label, action, entityId, details] of [["audit-review", "CORRECTIONS_PROGRAMME_APPROVED", ids.programme, { submissionId: ids["submission-2"] }],
      ["audit-schedule", "CORRECTIONS_REQUEST_SCHEDULED", ids["request-pending"], { intentId: ids["intent-request-pending"] }],
      ["audit-delivery", "CORRECTIONS_REQUEST_DELIVERY_CONFIRMED", ids["request-delivered"], { intentId: ids["intent-request-delivered"], proofEventId: id("client-proof-completed") }]])
      await make("auditLog", label, { organisationId: scope.organisationId, actorUserId: ids["owner-a"], action, entityType: action.includes("PROGRAMME") ? "CorrectionsProgramme" : "CorrectionsRequest", entityId, details, createdAt: at(300) });

    // Historical, signed C8 interrupted playback evidence for the same
    // reviewed source. B has its own facility and proof identity but no content.
    const submission = await fixtureOperation("LOOKUP", "correctionsSubmission", () => tx.correctionsSubmission.findUnique({ where: { id: ids["submission-2"] } }));
    await make("correctionsProgrammeDistribution", "edge-distribution", { organisationId: scope.organisationId,
      sourceFacilityId: scope.facilityId, targetFacilityId: scope.facilityId, programmeId: ids.programme,
      submissionId: submission.id, effectiveFrom: at(-300), createdByUserId: ids["owner-a"], createdAt: at(-300) });
    const edgeLocal = localDateTimeParts(at(2), "Europe/Malta");
    await make("correctionsNetworkWindow", "edge-window", { organisationId: scope.organisationId, facilityId: scope.facilityId,
      kind: "CENTRAL", distributionId: ids["edge-distribution"], weekday: edgeLocal.weekday,
      startMinute: 0, endMinute: 1440, allowedContentTypes: ["PROGRAMME"], createdByUserId: ids["owner-a"] });
    const content = { mediaAssetId: ids["render-media-2"], promoVersionId: ids["promo-version-2"],
      sha256: media[2].checksumSha256, sizeBytes: media[2].sizeBytes, mimeType: "audio/wav", durationSeconds: 2,
      rightsUse: "CORRECTIONS_RADIO", sourceType: "PROGRAMME" };
    const contentKey = `${content.mediaAssetId}:${content.promoVersionId}:${content.sha256}`;
    const sourceRevision = `c7:${ids["edge-window"]}:${ids["edge-distribution"]}:${submission.id}:${submission.sourceFingerprint}`;
    const signedWindow = { id: ids["edge-window"], facilityId: scope.facilityId, kind: "CENTRAL", mandatory: false,
      weekday: edgeLocal.weekday, startMinute: 0, endMinute: 1440, distributionId: ids["edge-distribution"],
      contentKey, sourceRevision, programmingSource: "CORRECTIONS_CENTRAL", effectiveFrom: at(-300).toISOString(), effectiveUntil: null };
    async function makeEdgeNode(label, nodeId, organisationId, facilityId, keys) {
      ids[label] = nodeId;
      const credential = createEdgeCredential(nodeId);
      return fixtureOperation("CREATE", "correctionsEdgeNode", () => tx.correctionsEdgeNode.create({ data: {
        id: nodeId, organisationId, facilityId, name: `Fictional recovery ${label}`, status: "ACTIVE",
        credentialHash: hashEdgeCredential(credential, EDGE_CREDENTIAL_SECRET), proofPublicKeyPem: publicPem(keys),
        keyVersion: 1, enrolledAt: TIME, lastSeenAt: at(1), lastSyncAt: at(1), lastSuccessfulSyncAt: at(1)
      } }));
    }
    await makeEdgeNode("edge-node-a", EDGE_NODE_A, scope.organisationId, scope.facilityId, proofKeysA);
    await makeEdgeNode("edge-node-b", EDGE_NODE_B, ids["org-b"], ids["facility-b"], proofKeysB);
    const sharedManifest = { schema: 1, sequence: 1, issuedAt: TIME.toISOString(), validUntil: at(86_400).toISOString(),
      timezone: "Europe/Malta", territoryCode: "MT", policy: { centralVersion: 1, facilityVersion: 1 }, insertions: [], overrides: [] };
    const signedA = signEdgeManifest({ ...sharedManifest, nodeId: EDGE_NODE_A, ...scope,
      zones: [{ id: ids["zone-facility-a"], channelId: ids.channel, playerIds: [ids.player] }],
      windows: [signedWindow], content: [content] }, privatePem(cloudKeys));
    const signedB = signEdgeManifest({ ...sharedManifest, nodeId: EDGE_NODE_B,
      organisationId: ids["org-b"], facilityId: ids["facility-b"], zones: [], windows: [], content: [] }, privatePem(cloudKeys));
    for (const [label, nodeId, signed] of [["edge-manifest-a", EDGE_NODE_A, signedA], ["edge-manifest-b", EDGE_NODE_B, signedB]])
      await make("correctionsEdgeManifest", label, { nodeId, sequence: 1, version: signed.version,
        payload: signed.payload, signature: signed.signature, validFrom: TIME, validUntil: at(86_400), createdAt: TIME });

    const sessionId = "5df6fb15-f73b-4c34-b359-bcae7f53f908";
    const baseProof = { schema: 1, nodeId: EDGE_NODE_A, ...scope, zoneId: ids["zone-facility-a"], playerId: ids.player,
      sessionId, manifestVersion: signedA.version, contentKey, programmingSource: signedWindow.programmingSource,
      windowId: signedWindow.id, overrideId: null };
    const started = signCorrectionsEdgeProof(1, null, { ...baseProof, eventId: "2d8ba00c-6aa0-4fb8-a04e-95017484f177",
      eventType: "STARTED", occurredAt: at(2).toISOString(), positionSeconds: 0 }, privatePem(proofKeysA));
    const interrupted = signCorrectionsEdgeProof(2, started.eventHash, { ...baseProof,
      eventId: "53220f20-8af0-4300-a929-f909824338b4", eventType: "INTERRUPTED",
      occurredAt: at(4).toISOString(), positionSeconds: 0 }, privatePem(proofKeysA));
    await make("playoutIntent", "edge-intent", { organisationId: scope.organisationId,
      scheduleItemId: sha256(`c8:${EDGE_NODE_A}:${sessionId}`), playerId: ids.player, zoneId: ids["zone-facility-a"],
      channelId: ids.channel, mediaAssetId: content.mediaAssetId, promoVersionId: content.promoVersionId,
      locationId: scope.facilityId, locationName: "Fictional facility-a", locationTimezone: "Europe/Malta", locationGroups: [],
      publicationRevision: 1, sourceRevision, plannedStart: at(2), expiresAt: at(86_400),
      correctionsProgrammeId: ids.programme, correctionsSubmissionId: submission.id });
    for (const [label, record] of [["edge-started", started], ["edge-interrupted", interrupted]]) {
      await make("proofOfPlayEvent", `edge-shared-${label}`, { organisationId: scope.organisationId,
        clientEventId: record.payload.eventId, playerId: ids.player, zoneId: ids["zone-facility-a"], channelId: ids.channel,
        scheduleItemId: sha256(`c8:${EDGE_NODE_A}:${sessionId}`), itemType: "CORRECTIONS_AUDIO",
        playoutIntentId: ids["edge-intent"], mediaAssetId: content.mediaAssetId, promoVersionId: content.promoVersionId,
        manifestVersion: signedA.version.slice(0, 24), programmingSource: signedWindow.programmingSource,
        eventType: record.payload.eventType, occurredAt: new Date(record.payload.occurredAt), positionSeconds: 0,
        failureReason: record.payload.eventType === "INTERRUPTED" ? "Edge player reported interruption" : null,
        playerName: "Fictional player", locationName: "Fictional facility-a", zoneName: "Fictional facility-a zone",
        trackTitle: "Fictional reviewed programme", trackArtist: "Fictional contributor" });
      await make("correctionsEdgeProofEvent", `edge-raw-${label}`, { nodeId: EDGE_NODE_A, sequence: record.sequence,
        eventId: record.payload.eventId, previousHash: record.previousHash, eventHash: record.eventHash,
        signature: record.signature, payload: record.payload, occurredAt: new Date(record.payload.occurredAt),
        receivedAt: at(300), proofOfPlayEventId: ids[`edge-shared-${label}`] });
    }
    await fixtureOperation("CHECKPOINT", "correctionsEdgeNode", () => tx.correctionsEdgeNode.update({ where: { id: EDGE_NODE_A },
      data: { lastProofSequence: 2, lastProofHash: interrupted.eventHash, pendingProofCount: 0 } }));
  }, { timeout: 60_000 }));
  return { fixtureVersion: 2, ids, rowDigests: await fixtureOperation("DIGEST_CAPTURE", null, () => digests(db)), media,
    edgeCloudPublicKeyPem: cloudPublicKeyPem,
    checks: ["exact-row-digests", "public-plan-catalogue", "tenant-and-facility-isolation", "contributor-capabilities", "studio-and-review-history",
      "delivery-proof-and-audit", "edge-signed-authority-and-scope", "edge-raw-proof-chain-and-replay-anchors",
      "edge-privacy-inventory-counts", "edge-no-false-completion"] };
}

export async function assertCorrectionsRecoveryFixture(db, expected) {
  assert.equal(await databaseName(db), TARGET, "Recovery assertions require the dedicated restored target.");
  assert.equal(expected.fixtureVersion, 2);
  assert.deepEqual(await digests(db), expected.rowDigests, "All restored IDs, fields, relationships and history must match the source digests.");
  await assertPublicPlanCatalogue(db);
  const ids = expected.ids, get = (model, label, include) => db[model].findUnique({ where: { id: ids[label] }, ...(include ? { include } : {}) });
  const grant = await get("correctionsFacilityGrant", "grant-manager-a");
  const authority = { role: "MANAGER", organisationId: ids["org-a"], memberId: ids["member-manager-a"], locationId: ids["facility-a"], assignment: grant, edit: true };
  assert.equal(correctionsFacilityPermission(authority), true);
  assert.equal(correctionsFacilityPermission({ ...authority, locationId: ids["facility-a-other"] }), false);
  assert.equal(correctionsFacilityPermission({ ...authority, organisationId: ids["org-b"], locationId: ids["facility-b"] }), false);
  assert.equal(correctionsProgrammePermission({ ...authority, facilityId: ids["facility-a"], action: "SCHEDULE" }), true);
  assert.equal(correctionsProgrammePermission({ ...authority, facilityId: ids["facility-b"], action: "SCHEDULE" }), false);
  assert.equal(await db.correctionsProgramme.count({ where: { id: ids.programme, organisationId: ids["org-b"] } }), 0);
  assert.equal(await db.correctionsProgramme.count({ where: { id: ids.programme, facilityId: ids["facility-a-other"] } }), 0);
  const session = await get("correctionsStudioSession", "session", { contributor: true, project: true, programme: true });
  assert.equal(session.contributor.organisationId, ids["org-a"]); assert.equal(session.contributor.facilityId, ids["facility-a"]);
  assert.equal(session.project.id, ids.project); assert.equal(session.programme.id, ids.programme);
  for (const capability of CORRECTIONS_STUDIO_CAPABILITIES) assert.equal(correctionsStudioCan(session, capability), true);
  for (const capability of ["APPROVE", "REVIEW", "SCHEDULE", "PUBLISH"]) assert.equal(correctionsStudioCan(session, capability), false);
  assert.equal(await db.user.count({ where: { id: ids.contributor } }), 0);
  assert.equal(await db.organisationMember.count({ where: { userId: ids.contributor } }), 0);
  const programme = await get("correctionsProgramme", "programme"), submission = await get("correctionsSubmission", "submission-2", { reviews: true });
  const organisationPolicy = await db.correctionsProfile.findUnique({ where: { organisationId: ids["org-a"] } });
  const facilityPolicy = await db.correctionsFacility.findUnique({ where: { locationId: ids["facility-a"] } });
  const render = await get("audioRender", "render-2", { outputMediaAsset: true, outputPromoVersion: true, version: true });
  const gate = { programme, submission, reviews: submission.reviews, organisationPolicy, facilityPolicy, render };
  assert.equal(correctionsSchedulingGate(gate).allowed, true);
  assert.equal(correctionsSchedulingGate({ ...gate, render: { ...render, versionId: ids["version-1"] } }).allowed, false);
  assert.throws(() => correctionsReviewTransition({ ...gate, submission: { ...submission, status: "SUBMITTED" }, reviews: [], stage: "STAFF", decision: "APPROVE", reviewerUserId: submission.submittedByUserId }), /cannot review their own/);
  const old = await get("correctionsSubmission", "submission-1", { reviews: true });
  assert.equal(old.status, "CHANGES_REQUESTED"); assert.equal(old.reviews[0].decision, "CHANGES_REQUESTED");
  assert.deepEqual(submission.reviews.map((review) => review.stage).sort(), ["FACILITY", "STAFF"]);
  assert.notEqual(submission.reviews[0].reviewedByUserId, submission.reviews[1].reviewedByUserId);
  assert.equal(render.version.state.takeId, ids.take); assert.equal((await get("audioTake", "take")).mediaAssetId, ids["take-media"]);
  for (const item of expected.media) {
    const bytes = Buffer.from(item.bytesBase64, "base64");
    assert.equal(bytes.length, item.sizeBytes); assert.equal(sha256(bytes), item.checksumSha256);
    const row = await db.mediaAsset.findUnique({ where: { id: item.mediaAssetId } });
    assert.equal(row.storageKey, item.storageKey); assert.equal(String(row.sizeBytes), String(item.sizeBytes));
  }
  const pending = await get("correctionsRequest", "request-pending"), delivered = await get("correctionsRequest", "request-delivered");
  assert.equal(pending.status, "SCHEDULED"); assert.equal(delivered.status, "PLAYED");
  assert.equal(correctionsRequestTransition(pending, "PLAYED"), null);
  assert.equal(await db.proofOfPlayEvent.count({ where: { playoutIntent: { correctionsRequestId: pending.id }, eventType: "COMPLETED" } }), 0);
  const proof = await get("proofOfPlayEvent", "proof-completed", { playoutIntent: true });
  assert.equal(proof.manifestVersion, RECOVERY_MANIFEST_VERSION);
  assert.equal(proof.eventType, "COMPLETED"); assert.equal(proof.playoutIntent.correctionsRequestId, delivered.id);
  for (const field of ["organisationId", "playerId", "zoneId", "scheduleItemId", "mediaAssetId", "promoVersionId", "channelId"]) assert.equal(proof[field], proof.playoutIntent[field]);
  const binding = { playerId: proof.playerId, manifestVersion: proof.manifestVersion, scheduleItemId: proof.scheduleItemId, contentId: proof.promoVersionId, programmingSource: proof.programmingSource };
  const token = createPlaybackProofToken(binding, PROOF_SECRET);
  assert.equal(verifyPlaybackProofToken(binding, token, PROOF_SECRET), true);
  assert.equal(verifyPlaybackProofToken({ ...binding, scheduleItemId: sha256("request-pending") }, token, PROOF_SECRET), false);
  assert.equal(verifyPlaybackProofToken({ ...binding, playerId: ids["owner-b"] }, token, PROOF_SECRET), false);
  const audit = await get("auditLog", "audit-delivery");
  assert.equal(audit.entityId, delivered.id); assert.equal(audit.details.proofEventId, proof.clientEventId);
  assert.equal(audit.details.intentId, proof.playoutIntentId);
  const nodeA = await get("correctionsEdgeNode", "edge-node-a", { facility: { include: { correctionsFacility: true } } });
  const nodeB = await get("correctionsEdgeNode", "edge-node-b", { facility: { include: { correctionsFacility: true } } });
  assert.ok(nodeA && nodeB, "Both known synthetic Edge identities must survive restore.");
  assert.equal(nodeA.id, EDGE_NODE_A); assert.equal(nodeB.id, EDGE_NODE_B);
  assert.equal(edgeNodeIsUsable(nodeA, at(3)), true); assert.equal(edgeNodeIsUsable(nodeB, at(3)), true);
  assert.equal(edgeNodeIsUsable({ ...nodeA, status: "REVOKED", revokedAt: at(2) }, at(3)), false);
  assert.equal(nodeA.organisationId, ids["org-a"]); assert.equal(nodeA.facilityId, ids["facility-a"]);
  assert.equal(nodeB.organisationId, ids["org-b"]); assert.equal(nodeB.facilityId, ids["facility-b"]);
  assert.notEqual(nodeA.proofPublicKeyPem, nodeB.proofPublicKeyPem);
  assert.notEqual(nodeA.proofPublicKeyPem, expected.edgeCloudPublicKeyPem);
  assert.equal(await db.correctionsEdgeNode.count({ where: { organisationId: ids["org-a"] } }), 1);
  assert.equal(await db.correctionsEdgeNode.count({ where: { organisationId: ids["org-b"] } }), 1);
  assert.equal(await db.correctionsEdgeNode.count({ where: { facilityId: ids["facility-a-other"] } }), 0);
  const inventoryA = await countCorrectionsPrivacyInventory(db, ids["org-a"]);
  const inventoryB = await countCorrectionsPrivacyInventory(db, ids["org-b"]);
  for (const inventory of [inventoryA, inventoryB]) {
    assert.equal(Object.keys(inventory).length, 26, "Privacy inventory remains a 26-field count summary.");
    assert.equal(Object.values(inventory).every((value) => Number.isSafeInteger(value) && value >= 0), true,
      "Privacy inventory cannot contain record fields or identifiers.");
  }
  assert.deepEqual([inventoryA.edgeNodes, inventoryA.edgeSignedManifests, inventoryA.edgeRawProofEvents], [1, 1, 2]);
  assert.deepEqual([inventoryB.edgeNodes, inventoryB.edgeSignedManifests, inventoryB.edgeRawProofEvents], [1, 1, 0]);

  const manifestA = await get("correctionsEdgeManifest", "edge-manifest-a");
  const manifestB = await get("correctionsEdgeManifest", "edge-manifest-b");
  assert.ok(manifestA && manifestB, "Both known signed snapshots must survive restore.");
  const envelopeA = { payload: manifestA.payload, version: manifestA.version, signature: manifestA.signature };
  const envelopeB = { payload: manifestB.payload, version: manifestB.version, signature: manifestB.signature };
  const scopeA = { nodeId: nodeA.id, organisationId: nodeA.organisationId, facilityId: nodeA.facilityId };
  const scopeB = { nodeId: nodeB.id, organisationId: nodeB.organisationId, facilityId: nodeB.facilityId };
  assert.equal(verifyEdgeManifest(envelopeA, expected.edgeCloudPublicKeyPem, scopeA, { now: at(3) }), true);
  assert.equal(verifyEdgeManifest(envelopeB, expected.edgeCloudPublicKeyPem, scopeB, { now: at(3) }), true);
  assert.equal(verifyEdgeManifest(envelopeA, nodeA.proofPublicKeyPem, scopeA, { now: at(3) }), false);
  assert.equal(verifyEdgeManifest(envelopeA, expected.edgeCloudPublicKeyPem, scopeB, { now: at(3) }), false);
  assert.equal(verifyEdgeManifest(envelopeA, expected.edgeCloudPublicKeyPem,
    { ...scopeA, facilityId: ids["facility-a-other"] }, { now: at(3) }), false);
  assert.equal(verifyEdgeManifest(envelopeA, expected.edgeCloudPublicKeyPem, scopeA, { now: at(86_401) }), false);
  assert.equal(verifyEdgeManifest({ ...envelopeA, payload: { ...envelopeA.payload, content: [] } },
    expected.edgeCloudPublicKeyPem, scopeA, { now: at(3) }), false);
  assert.equal(manifestA.nodeId, nodeA.id); assert.equal(manifestB.nodeId, nodeB.id);
  assert.equal(manifestA.sequence, 1); assert.equal(manifestB.sequence, 1);
  assert.deepEqual(manifestB.payload.content, []); assert.deepEqual(manifestB.payload.windows, []);
  assert.equal(await db.correctionsEdgeManifest.count({ where: { node: { organisationId: ids["org-a"] } } }), 1);
  assert.equal(await db.correctionsEdgeManifest.count({ where: { node: { organisationId: ids["org-b"] } } }), 1);
  const distribution = await get("correctionsProgrammeDistribution", "edge-distribution");
  const edgeWindow = await get("correctionsNetworkWindow", "edge-window");
  const exactMedia = expected.media.find((item) => item.mediaAssetId === ids["render-media-2"]);
  assert.ok(distribution && edgeWindow && exactMedia);
  assert.equal(distribution.programmeId, ids.programme); assert.equal(distribution.submissionId, ids["submission-2"]);
  assert.equal(distribution.organisationId, nodeA.organisationId); assert.equal(distribution.targetFacilityId, nodeA.facilityId);
  assert.equal(edgeWindow.distributionId, distribution.id); assert.equal(edgeWindow.facilityId, nodeA.facilityId);
  assert.equal(manifestA.payload.windows.length, 1); assert.equal(manifestA.payload.content.length, 1);
  assert.equal(manifestA.payload.windows[0].id, edgeWindow.id);
  assert.equal(manifestA.payload.windows[0].distributionId, distribution.id);
  assert.equal(manifestA.payload.content[0].mediaAssetId, exactMedia.mediaAssetId);
  assert.equal(manifestA.payload.content[0].promoVersionId, ids["promo-version-2"]);
  assert.equal(manifestA.payload.content[0].sha256, exactMedia.checksumSha256);
  assert.equal(manifestA.payload.content[0].sizeBytes, exactMedia.sizeBytes);
  const resolved = resolveCorrectionsEdgePlayback(manifestA.payload,
    { zoneId: ids["zone-facility-a"], playerId: ids.player, instant: at(3) });
  assert.equal(resolved.state, "READY"); assert.equal(resolved.source, "CORRECTIONS_CENTRAL");
  assert.equal(resolved.windowId, edgeWindow.id);
  assert.equal(resolved.contentKey, `${exactMedia.mediaAssetId}:${ids["promo-version-2"]}:${exactMedia.checksumSha256}`);
  assert.equal(resolveCorrectionsEdgePlayback(manifestA.payload,
    { zoneId: ids["zone-facility-b"], playerId: ids.player, instant: at(3) }).state, "PLAYER_NOT_AUTHORISED");
  assert.equal(resolveCorrectionsEdgePlayback(manifestA.payload,
    { zoneId: ids["zone-facility-a"], playerId: ids.player, instant: at(86_401) }).state, "EXPIRED_OR_UNAVAILABLE");

  const edgeIntent = await get("playoutIntent", "edge-intent");
  assert.ok(edgeIntent, "The synthetic Edge playout intent must survive restore.");
  assert.equal(edgeIntent.sourceRevision, manifestA.payload.windows[0].sourceRevision);
  const raw = await db.correctionsEdgeProofEvent.findMany({ where: { nodeId: nodeA.id }, orderBy: { sequence: "asc" } });
  assert.equal(raw.length, 2, "A known nonempty raw Edge chain must survive restore.");
  assert.equal(edgeIntent.scheduleItemId, sha256(`c8:${nodeA.id}:${raw[0].payload.sessionId}`));
  assert.equal(await db.correctionsEdgeProofEvent.count({ where: { nodeId: nodeB.id } }), 0);
  assert.equal(await db.correctionsEdgeProofEvent.count({ where: { node: { organisationId: ids["org-a"] } } }), 2);
  assert.equal(await db.correctionsEdgeProofEvent.count({ where: { node: { organisationId: ids["org-b"] } } }), 0);
  let previousHash = null;
  for (const [index, row] of raw.entries()) {
    const record = { sequence: row.sequence, previousHash: row.previousHash, payload: row.payload,
      eventHash: row.eventHash, signature: row.signature };
    assert.equal(row.sequence, index + 1); assert.equal(row.previousHash, previousHash);
    assert.equal(row.eventId, row.payload.eventId); assert.equal(row.payload.manifestVersion, manifestA.version);
    assert.equal(row.payload.zoneId, ids["zone-facility-a"]); assert.equal(row.payload.playerId, ids.player);
    assert.equal(row.payload.sessionId, raw[0].payload.sessionId);
    assert.equal(row.payload.contentKey, resolved.contentKey);
    assert.equal(row.payload.windowId, manifestA.payload.windows[0].id);
    assert.equal(row.payload.programmingSource, manifestA.payload.windows[0].programmingSource);
    assert.equal(row.occurredAt.getTime(), Date.parse(row.payload.occurredAt));
    assert.equal(validCorrectionsEdgeProofPayload(row.payload, scopeA), true);
    assert.equal(validCorrectionsEdgeProofPayload(row.payload, scopeB), false);
    assert.equal(verifyCorrectionsEdgeProof(record, nodeA.proofPublicKeyPem,
      { sequence: index + 1, previousHash }), true);
    assert.equal(verifyCorrectionsEdgeProof(record, nodeB.proofPublicKeyPem,
      { sequence: index + 1, previousHash }), false);
    assert.equal(verifyCorrectionsEdgeProof({ ...record, payload: { ...row.payload, eventType: "COMPLETED" } },
      nodeA.proofPublicKeyPem, { sequence: index + 1, previousHash }), false);
    const bySequence = await db.correctionsEdgeProofEvent.findUnique({ where: {
      nodeId_sequence: { nodeId: nodeA.id, sequence: row.sequence } } });
    assert.equal(bySequence.id, row.id, "The restored sequence remains a stable replay anchor.");
    assert.equal(await db.correctionsEdgeProofEvent.count({ where: { eventId: row.eventId } }), 1);
    const shared = await db.proofOfPlayEvent.findUnique({ where: { id: row.proofOfPlayEventId } });
    assert.ok(shared, "Every accepted raw proof retains its materialised shared evidence.");
    assert.equal(shared.clientEventId, row.eventId); assert.equal(shared.eventType, row.payload.eventType);
    assert.equal(shared.manifestVersion, manifestA.version.slice(0, 24));
    assert.equal(shared.playerId, row.payload.playerId); assert.equal(shared.zoneId, row.payload.zoneId);
    assert.equal(shared.playoutIntentId, edgeIntent.id);
    assert.equal(shared.organisationId, nodeA.organisationId);
    assert.equal(shared.mediaAssetId, manifestA.payload.content[0].mediaAssetId);
    assert.equal(shared.promoVersionId, manifestA.payload.content[0].promoVersionId);
    assert.equal(shared.channelId, ids.channel);
    assert.equal(shared.scheduleItemId, edgeIntent.scheduleItemId);
    assert.equal(shared.programmingSource, row.payload.programmingSource);
    assert.equal(shared.occurredAt.getTime(), row.occurredAt.getTime());
    assert.equal(shared.positionSeconds, row.payload.positionSeconds);
    previousHash = row.eventHash;
  }
  assert.deepEqual(raw.map((row) => row.payload.eventType), ["STARTED", "INTERRUPTED"]);
  assert.equal(nodeA.lastProofSequence, 2); assert.equal(nodeA.lastProofHash, previousHash);
  assert.equal(edgeIntent.organisationId, nodeA.organisationId);
  assert.equal(edgeIntent.locationId, nodeA.facilityId);
  assert.equal(edgeIntent.correctionsRequestId, null, "An interrupted Edge session cannot complete a C5 request.");
  assert.equal(await db.proofOfPlayEvent.count({ where: { playoutIntentId: edgeIntent.id, eventType: "COMPLETED" } }), 0);
  return { passed: true, checks: expected.checks, rowCount: Object.values(expected.rowDigests).reduce((sum, rows) => sum + rows.length, 0), mediaCount: expected.media.length };
}
