import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { correctionsFacilityPermission } from "../../lib/corrections-policy.mjs";
import { correctionsProgrammePermission, correctionsRenderEvidence, correctionsContributorRenderEvidence,
  correctionsReviewTransition, correctionsSchedulingGate } from "../../lib/corrections-workflow.mjs";
import { CORRECTIONS_STUDIO_CAPABILITIES, correctionsStudioCan } from "../../lib/corrections-studio-policy.mjs";
import { correctionsRequestTransition } from "../../lib/corrections-c5-policy.mjs";
import { createPlaybackProofToken, verifyPlaybackProofToken } from "../../lib/playback-proof.mjs";
import { recoveryContainerAddress, assertRecoveryDatabaseUrl } from "../../lib/corrections-recovery-rehearsal-safety.mjs";

const SOURCE = "ruvanas_c9_recovery_source";
const TARGET = "ruvanas_c9_recovery_target";
const PREFIX = "fictional-c9-recovery-";
const TIME = new Date("2026-01-02T10:00:00.000Z");
const PROOF_SECRET = "fictional-recovery-proof-secret-ci-only-2026";
const MODELS = ["plan", "organisation", "subscription", "organisationMediaProfile", "user", "organisationMember", "location", "zone",
  "correctionsProfile", "correctionsFacility", "correctionsFacilityGrant", "station", "channel", "channelAssignment",
  "player", "correctionsProgramme", "correctionsContributor", "audioProject", "audioProjectVersion", "mediaAsset",
  "promoAsset", "promoVersion", "audioTake", "audioRender", "correctionsStudioSession", "correctionsSubmission",
  "correctionsReview", "correctionsRequest", "correctionsRequestDecision", "playoutIntent", "proofOfPlayEvent", "auditLog"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
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
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Recovery fixture requires disposable GitHub Actions infrastructure.");
  assert.equal(process.env.C9_RECOVERY_REHEARSAL, "true", "Recovery fixture requires the explicit rehearsal flag.");
  const host = recoveryContainerAddress(container, ownership, network);
  assertRecoveryDatabaseUrl(sourceDatabaseUrl, { host, port: 5432, password, database: SOURCE });
  assert.equal(await databaseName(db), SOURCE, "Connected database must be the dedicated source.");
  for (const model of MODELS) assert.equal(await db[model].count(MIGRATION_BASELINE[model]
    ? { where: { id: { notIn: MIGRATION_BASELINE[model] } } } : undefined), 0, `Source ${model} table must contain only migration baseline rows.`);
  await assertPublicPlanCatalogue(db);
  const ids = {}, media = [];
  await db.$transaction(async (tx) => {
    const make = async (model, label, data) => {
      ids[label] = id(label);
      return tx[model].create({ data: { id: ids[label], ...data } });
    };
    ids.plan = "public-plan-corrections-network";
    const plan = await tx.plan.findUnique({ where: { id: ids.plan } });
    assert.ok(plan && plan.code === "CORRECTIONS_NETWORK" && plan.productFamily === "CORRECTIONS" && plan.tierNumber === 4 && plan.correctionsRadioEnabled === true,
      "The fixture must use the existing migrated Inside Network plan.");
    for (const tenant of ["a", "b"]) {
      await make("organisation", `org-${tenant}`, { name: `Fictional organisation ${tenant}`, slug: id(`org-${tenant}`) });
      await make("subscription", `subscription-${tenant}`, { organisationId: ids[`org-${tenant}`], planId: plan.id, status: "ACTIVE" });
      await tx.correctionsProfile.create({ data: { organisationId: ids[`org-${tenant}`], policyConfiguredAt: TIME } });
    }
    for (const [label, role, tenant] of [["owner-a", "OWNER", "a"], ["manager-a", "MANAGER", "a"], ["reviewer-a", "MANAGER", "a"], ["owner-b", "OWNER", "b"]]) {
      await make("user", label, { name: `Fictional ${label}`, email: `${label}@recovery.example.invalid`, passwordHash: "ci-only-unusable", role });
      await make("organisationMember", `member-${label}`, { userId: ids[label], organisationId: ids[`org-${tenant}`], role });
    }
    for (const [label, tenant] of [["facility-a", "a"], ["facility-a-other", "a"], ["facility-b", "b"]]) {
      await make("location", label, { organisationId: ids[`org-${tenant}`], name: `Fictional ${label}`, slug: label,
        status: "ACTIVE", countryCode: "MT", timezone: "Europe/Malta" });
      await tx.correctionsFacility.create({ data: { locationId: ids[label], policyConfiguredAt: TIME, dualApprovalRequired: true, requestAvailability: "INTERNAL_ONLY" } });
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
      const render = await tx.audioRender.findUnique({ where: { id: ids[`render-${revision}`] }, include: { outputMediaAsset: true, outputPromoVersion: true } });
      const evidence = revision === 1 ? correctionsRenderEvidence(render) : correctionsContributorRenderEvidence(render, {
        organisationId: scope.organisationId, projectId: ids.project, versionId: ids[`version-${revision}`] });
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
        sourceRevision: `${ids["submission-2"]}:${(await tx.correctionsSubmission.findUnique({ where: { id: ids["submission-2"] } })).sourceFingerprint}`,
        plannedStart: at(label === "request-pending" ? 100 : 200), expiresAt: at(label === "request-pending" ? 192 : 292),
        correctionsRequestId: ids[label], correctionsProgrammeId: ids.programme, correctionsSubmissionId: ids["submission-2"] });
    }
    for (const [label, request, eventType] of [["proof-failed", "request-pending", "FAILED"], ["proof-completed", "request-delivered", "COMPLETED"]])
      await make("proofOfPlayEvent", label, { organisationId: scope.organisationId, clientEventId: id(`client-${label}`), playerId: ids.player, zoneId: ids["zone-facility-a"],
        scheduleItemId: sha256(request), itemType: "CORRECTIONS_AUDIO", playoutIntentId: ids[`intent-${request}`], channelId: ids.channel,
        mediaAssetId: ids["render-media-2"], promoVersionId: ids["promo-version-2"], manifestVersion: "fictional-recovery-manifest-1", programmingSource: "CORRECTIONS_REQUEST",
        eventType, occurredAt: at(request === "request-pending" ? 101 : 202), positionSeconds: eventType === "COMPLETED" ? 2 : 0,
        playerName: "Fictional player", locationName: "Fictional facility-a", zoneName: "Fictional facility-a zone", trackTitle: "Fictional approved programme", trackArtist: "Fictional contributor" });
    for (const [label, action, entityId, details] of [["audit-review", "CORRECTIONS_PROGRAMME_APPROVED", ids.programme, { submissionId: ids["submission-2"] }],
      ["audit-schedule", "CORRECTIONS_REQUEST_SCHEDULED", ids["request-pending"], { intentId: ids["intent-request-pending"] }],
      ["audit-delivery", "CORRECTIONS_REQUEST_DELIVERY_CONFIRMED", ids["request-delivered"], { intentId: ids["intent-request-delivered"], proofEventId: id("client-proof-completed") }]])
      await make("auditLog", label, { organisationId: scope.organisationId, actorUserId: ids["owner-a"], action, entityType: action.includes("PROGRAMME") ? "CorrectionsProgramme" : "CorrectionsRequest", entityId, details, createdAt: at(300) });
  }, { timeout: 60_000 });
  return { fixtureVersion: 1, ids, rowDigests: await digests(db), media,
    checks: ["exact-row-digests", "public-plan-catalogue", "tenant-and-facility-isolation", "contributor-capabilities", "studio-and-review-history", "delivery-proof-and-audit"] };
}

export async function assertCorrectionsRecoveryFixture(db, expected) {
  assert.equal(await databaseName(db), TARGET, "Recovery assertions require the dedicated restored target.");
  assert.equal(expected.fixtureVersion, 1);
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
  return { passed: true, checks: expected.checks, rowCount: Object.values(expected.rowDigests).reduce((sum, rows) => sum + rows.length, 0), mediaCount: expected.media.length };
}
