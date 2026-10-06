import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { correctionsContributorRenderEvidence, correctionsRenderEvidence,
  correctionsSchedulingGate } from "../lib/corrections-workflow.mjs";
import { correctionsStudioSourceIds, correctionsStudioSourcesCurrent } from "../lib/corrections-studio-sources.mjs";
import { correctionsWindowConflict, normalizeCorrectionsNetworkWindow,
  resolveCorrectionsDistributionTargets } from "../lib/corrections-network-policy.mjs";
import { correctionsNetworkSourcePolicy } from "../lib/corrections-network-source-policy.mjs";
import { assertStudioRenderReady } from "../lib/studio-product-handoff.mjs";

const serviceUrl = new URL("../lib/corrections-network-programming-service.js", import.meta.url);
const checksum = "a".repeat(64);

// Execute the actual service body with an explicit dependency map. The supplied
// transaction has read methods only; this suite never constructs a Prisma
// client, starts a server, or contacts a database or storage provider.
async function loadService() {
  const forbidden = () => { throw new Error("This source-validation test must remain read-only."); };
  const modules = {
    "@/lib/prisma": { prisma: Object.freeze({}) },
    "@/lib/transaction-retry.mjs": { runSerializableTransaction: forbidden },
    "@/lib/corrections-workflow.mjs": { correctionsSchedulingGate },
    "@/lib/corrections-studio-sources.mjs": { correctionsStudioSourceIds, correctionsStudioSourcesCurrent },
    "@/lib/corrections-network-service": { correctionsNetworkAuthority: forbidden },
    "@/lib/job-notification-service": { enqueueNotificationEvent: forbidden },
    "@/lib/entitlements.mjs": { resolveEntitlements: forbidden },
    "@/lib/corrections-network-policy.mjs": { correctionsWindowConflict, normalizeCorrectionsNetworkWindow,
      resolveCorrectionsDistributionTargets },
    "@/lib/corrections-network-source-policy.mjs": { correctionsNetworkSourcePolicy },
    "@/lib/corrections-network-audio-service": { approvedCorrectionsNetworkAudioSource: forbidden,
      assertCorrectionsNetworkAudioTarget: forbidden }
  };
  const context = {};
  const source = (await readFile(serviceUrl, "utf8")).replace(
    /^import\s*\{([^}]+)\}\s+from\s+"([^"]+)";[ \t]*$/gm,
    (declaration, names, specifier) => {
      assert.ok(Object.hasOwn(modules, specifier), `Unexpected service dependency: ${specifier}`);
      for (const name of names.split(",").map((value) => value.trim())) {
        assert.ok(Object.hasOwn(modules[specifier], name), `Unexpected service import: ${name}`);
        assert.ok(!Object.hasOwn(context, name), `Duplicate service binding: ${name}`);
        context[name] = modules[specifier][name];
      }
      return declaration.replace(/[^\n]/g, "");
    }
  ).replace(/^export\s+/gm, "");
  assert.doesNotMatch(source, /^import\b/m, "Every service import must use the explicit dependency map.");
  assert.doesNotMatch(source, /^export\b/m);
  return runInNewContext(`${source}\n({ approvedCorrectionsNetworkSource, assertCorrectionsNetworkTarget });`, context,
    { filename: serviceUrl.pathname });
}

const service = await loadService();

function fixture(kind = "supervised") {
  const now = Date.now();
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000);
  const organisationId = "fictional-org";
  const facilityId = "fictional-facility";
  const programmeId = "fictional-programme";
  const projectId = "fictional-project";
  const versionId = "fictional-version";
  const renderId = "fictional-render";
  const sessionId = "fictional-session";
  const contributorId = "fictional-contributor";
  const sourceMedia = { id: "fictional-source-media", organisationId, status: "READY",
    libraryType: "ORGANISATION_PROMO", mediaType: "VOICEOVER", genres: [] };
  const render = { id: renderId, organisationId, projectId, versionId, requestedByUserId: "fictional-supervisor",
    createdAt: at(140), completedAt: at(130), status: "SUCCEEDED",
    resultJson: { immutableSource: true, checksumSha256: checksum },
    outputMediaAsset: { id: "fictional-output-media", organisationId, status: "READY",
      sizeBytes: 16_044n, storageKey: "fictional/private/output.wav", durationSeconds: 2 },
    outputPromoVersion: { id: "fictional-output-promo", mediaAssetId: "fictional-output-media",
      status: kind === "supervised" ? "IN_REVIEW" : "APPROVED", qcStatus: "PASSED", checksumSha256: checksum,
      sourceReference: `audio-render:${renderId}`,
      promoAsset: { organisationId, status: "ACTIVE",
        currentApprovedVersionId: kind === "supervised" ? null : "fictional-output-promo" } },
    version: { id: versionId, projectId, createdAt: at(150),
      state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: sourceMedia.id }] } } },
    project: { organisationId, createdByUserId: "fictional-supervisor" } };
  const evidence = kind === "supervised"
    ? correctionsContributorRenderEvidence(render, { organisationId, projectId, versionId })
    : correctionsRenderEvidence(render);
  const programme = { id: programmeId, organisationId, facilityId, status: "APPROVED", latestRevision: 1,
    networkOrigin: "CENTRAL" };
  const session = { id: sessionId, organisationId, facilityId, programmeId, contributorId, projectId,
    supervisorUserId: "fictional-supervisor", status: "SUBMITTED", revokedAt: null,
    createdAt: at(200), activatedAt: at(180), expiresAt: at(60), completedAt: at(120),
    contributor: { id: contributorId, organisationId, facilityId } };
  const submission = { id: "fictional-submission", programmeId, organisationId, facilityId, revision: 1,
    renderId, sourceFingerprint: evidence.fingerprint, organisationPolicyVersion: 1, facilityPolicyVersion: 1,
    dualApprovalRequired: false, status: "APPROVED", submittedByUserId: "fictional-supervisor",
    contributorId: kind === "supervised" ? contributorId : null,
    studioSessionId: kind === "supervised" ? sessionId : null,
    studioProjectId: kind === "supervised" ? projectId : null,
    studioVersionId: kind === "supervised" ? versionId : null,
    studioSession: kind === "supervised" ? session : null,
    evidenceSnapshot: kind === "supervised" ? { reviewPolicyVersion: "C3.1",
      sourceKind: "SUPERVISED_STUDIO_PENDING_REVIEW", ...evidence, facilityId, programmeId,
      contributorId, studioSessionId: sessionId, projectId, revision: 1,
      organisationPolicyVersion: 1, facilityPolicyVersion: 1 } : { ...evidence },
    reviews: [{ stage: "STAFF", decision: "APPROVE", reviewedByUserId: "fictional-reviewer" }] };
  const organisationPolicy = { policyVersion: 1, policyConfiguredAt: at(300), cleanOnly: true,
    blockedTrackIds: [], restrictedGenres: [], allowedGenres: [] };
  const facilityPolicy = { locationId: facilityId, policyVersion: 1, policyConfiguredAt: at(300),
    cleanOnly: true, blockedTrackIds: [], restrictedGenres: [], allowedGenres: [],
    location: { id: facilityId, organisationId, status: "ACTIVE", countryCode: "MT" } };
  const take = { organisationId, projectId, mediaAssetId: sourceMedia.id, status: "READY", trashedAt: null,
    mediaAsset: sourceMedia, promoVersion: { id: "fictional-source-promo", status: "APPROVED", qcStatus: "PASSED",
      promoAsset: { status: "ACTIVE", currentApprovedVersionId: "fictional-source-promo" } } };
  return { organisationId, facilityId, programme, submission, render, session, organisationPolicy,
    facilityPolicy, takes: [take] };
}

function readOnlyTransaction(state) {
  const queries = [];
  const tx = {
    correctionsProgramme: { findFirst: async (query) => {
      queries.push(["programme", query]);
      assert.equal(query.where.id, state.programme.id);
      assert.equal(query.where.organisationId, state.organisationId);
      assert.equal(query.where.status, "APPROVED");
      return state.programme.status === "APPROVED" ? state.programme : null;
    } },
    correctionsSubmission: {
      findFirst: async (query) => {
        queries.push(["pinned-submission", query]);
        assert.equal(query.where.id, state.submission.id);
        assert.equal(query.where.programmeId, state.programme.id);
        assert.equal(query.where.organisationId, state.organisationId);
        assert.equal(query.where.status, "APPROVED");
        assertSubmissionInclude(query.include);
        return state.submission.status === "APPROVED" ? state.submission : null;
      },
      findUnique: async (query) => {
        queries.push(["current-submission", query]);
        assert.equal(query.where.programmeId_revision.programmeId, state.programme.id);
        assert.equal(query.where.programmeId_revision.revision, state.programme.latestRevision);
        assertSubmissionInclude(query.include);
        return state.submission.revision === state.programme.latestRevision ? state.submission : null;
      }
    },
    correctionsProfile: { findUnique: async (query) => {
      queries.push(["organisation-policy", query]);
      assert.equal(query.where.organisationId, state.organisationId);
      return state.organisationPolicy;
    } },
    correctionsFacility: { findFirst: async (query) => {
      queries.push(["facility-policy", query]);
      assert.equal(query.where.locationId, state.facilityId);
      assert.equal(query.where.location.organisationId, state.organisationId);
      assert.equal(query.where.location.status, "ACTIVE");
      return state.facilityPolicy;
    } },
    audioRender: { findFirst: async (query) => {
      queries.push(["render", query]);
      assert.equal(query.where.id, state.submission.renderId);
      assert.equal(query.where.organisationId, state.organisationId);
      for (const field of ["id", "projectId", "createdAt", "state"]) {
        assert.equal(query.include.version.select[field], true, `Render version must select ${field}.`);
      }
      return state.render.organisationId === state.organisationId && state.render.id === state.submission.renderId
        ? state.render : null;
    } },
    audioTake: { findMany: async (query) => {
      queries.push(["takes", query]);
      assert.equal(query.where.organisationId, state.organisationId);
      assert.equal(query.where.projectId, state.render.projectId);
      assert.ok(query.where.mediaAssetId.in.includes(state.takes[0].mediaAssetId));
      return state.takes.filter((take) => take.organisationId === query.where.organisationId &&
        take.projectId === query.where.projectId && query.where.mediaAssetId.in.includes(take.mediaAssetId));
    } }
  };
  return { tx, queries };
}

function assertSubmissionInclude(include) {
  assert.equal(include.reviews, true);
  const contributor = include.studioSession.include.contributor.select;
  for (const field of ["id", "organisationId", "facilityId"]) {
    assert.equal(contributor[field], true, `Submission must select contributor ${field}.`);
  }
}

async function sourceFor(state, pinned = false) {
  const { tx, queries } = readOnlyTransaction(state);
  const before = structuredClone(state);
  const result = await service.approvedCorrectionsNetworkSource(tx, state.organisationId,
    state.programme.id, pinned ? state.submission.id : null);
  assert.deepEqual(state, before, "Source validation must not mutate its rows.");
  return { result, queries };
}

async function rejectsSource(state, pinned = false) {
  const { tx } = readOnlyTransaction(state);
  const before = structuredClone(state);
  await assert.rejects(service.approvedCorrectionsNetworkSource(tx, state.organisationId,
    state.programme.id, pinned ? state.submission.id : null), (error) => error?.status === 409);
  assert.deepEqual(state, before, "A rejected source must not mutate its rows.");
}

test("Guard-approved supervised IN_REVIEW output is a private C7 source, even after its session expires", async () => {
  const state = fixture();
  assert.ok(state.session.expiresAt < new Date());
  assert.throws(() => assertStudioRenderReady(state.render), /Approve the final Studio output/,
    "ordinary Studio product handoff must still reject IN_REVIEW");
  const { result, queries } = await sourceFor(state);
  assert.equal(result.submission.id, state.submission.id);
  assert.equal(result.render.outputPromoVersion.status, "IN_REVIEW");
  assert.equal(result.render.outputPromoVersion.promoAsset.currentApprovedVersionId, null);
  assert.equal(result.sourceMedia[0].id, state.takes[0].mediaAssetId);
  assert.ok(queries.some(([name]) => name === "current-submission"));
});

test("an older, separately Guard-approved C4 revision can remain pinned without a global promo approval", async () => {
  const state = fixture();
  state.programme.latestRevision = 2;
  const { result, queries } = await sourceFor(state, true);
  assert.equal(result.submission.revision, 1);
  assert.ok(queries.some(([name]) => name === "pinned-submission"));
  await rejectsSource(state, false);
});

test("a valid near-expiry C4 submission remains distributable when its completion commits after expiry", async () => {
  const state = fixture();
  state.session.expiresAt = new Date(state.render.completedAt.getTime() + 5 * 60_000);
  assert.ok(state.render.completedAt < state.session.expiresAt);
  assert.ok(state.session.expiresAt < state.session.completedAt);
  assert.ok(state.session.expiresAt < new Date());
  assert.equal((await sourceFor(state)).result.submission.id, state.submission.id);
});

test("legacy approved Studio source retains current-pointer checks, with a separately approved pinned revision", async () => {
  const state = fixture("legacy");
  assert.equal(assertStudioRenderReady(state.render), state.render,
    "ordinary Studio handoff remains available for its approved output");
  assert.equal((await sourceFor(state)).result.render.outputPromoVersion.status, "APPROVED");
  state.render.outputPromoVersion.promoAsset.currentApprovedVersionId = "different-approved-version";
  await rejectsSource(state);
  state.programme.latestRevision = 2;
  assert.equal((await sourceFor(state, true)).result.submission.id, state.submission.id);
  state.render.outputPromoVersion.status = "IN_REVIEW";
  await rejectsSource(state, true);
});

test("C4 network source requires final Guard review and passed QC", async () => {
  const pending = fixture();
  pending.submission.status = "SUBMITTED";
  await rejectsSource(pending);
  const dual = fixture();
  dual.submission.dualApprovalRequired = true;
  await rejectsSource(dual);
  const qc = fixture();
  qc.render.outputPromoVersion.qcStatus = "PENDING";
  await rejectsSource(qc);
});

test("C4 source fails closed on session, contributor, programme and render identity drift", async () => {
  const mutations = [
    ["missing session reference", (s) => { s.submission.studioSessionId = null; }],
    ["missing contributor reference", (s) => { s.submission.contributorId = null; }],
    ["missing project reference", (s) => { s.submission.studioProjectId = null; }],
    ["missing version reference", (s) => { s.submission.studioVersionId = null; }],
    ["session no longer submitted", (s) => { s.session.status = "REVOKED"; }],
    ["session revoked", (s) => { s.session.revokedAt = new Date(); }],
    ["session not completed", (s) => { s.session.completedAt = null; }],
    ["session tenant mismatch", (s) => { s.session.organisationId = "foreign-org"; }],
    ["session facility mismatch", (s) => { s.session.facilityId = "other-facility"; }],
    ["session programme mismatch", (s) => { s.session.programmeId = "other-programme"; }],
    ["session contributor mismatch", (s) => { s.session.contributorId = "other-contributor"; }],
    ["contributor tenant mismatch", (s) => { s.session.contributor.organisationId = "foreign-org"; }],
    ["contributor facility mismatch", (s) => { s.session.contributor.facilityId = "other-facility"; }],
    ["supervisor mismatch", (s) => { s.session.supervisorUserId = "other-supervisor"; }],
    ["project mismatch", (s) => { s.session.projectId = "other-project"; }],
    ["render requester mismatch", (s) => { s.render.requestedByUserId = "other-supervisor"; }],
    ["render project owner mismatch", (s) => { s.render.project.organisationId = "foreign-org"; }],
    ["version project mismatch", (s) => { s.render.version.projectId = "other-project"; }],
    ["version predates session", (s) => { s.render.version.createdAt = new Date(s.session.activatedAt.getTime() - 1000); }],
    ["render predates session", (s) => { s.render.createdAt = new Date(s.session.activatedAt.getTime() - 1000); }],
    ["snapshot session mismatch", (s) => { s.submission.evidenceSnapshot.studioSessionId = "other-session"; }],
    ["snapshot contributor mismatch", (s) => { s.submission.evidenceSnapshot.contributorId = "other-contributor"; }],
    ["snapshot project mismatch", (s) => { s.submission.evidenceSnapshot.projectId = "other-project"; }],
    ["snapshot render mismatch", (s) => { s.submission.evidenceSnapshot.renderId = "other-render"; }],
    ["snapshot version mismatch", (s) => { s.submission.evidenceSnapshot.versionId = "other-version"; }],
    ["snapshot media mismatch", (s) => { s.submission.evidenceSnapshot.mediaAssetId = "other-media"; }],
    ["snapshot promo mismatch", (s) => { s.submission.evidenceSnapshot.promoVersionId = "other-promo"; }],
    ["snapshot programme mismatch", (s) => { s.submission.evidenceSnapshot.programmeId = "other-programme"; }]
  ];
  for (const [label, mutate] of mutations) {
    const state = fixture();
    mutate(state);
    await rejectsSource(state).catch((error) => { error.message = `${label}: ${error.message}`; throw error; });
  }
});

test("C4 source rejects policy drift, changed fingerprint and downgraded source kind", async () => {
  for (const [label, mutate] of [
    ["organisation policy changed", (s) => { s.organisationPolicy.policyVersion = 2; }],
    ["facility policy changed", (s) => { s.facilityPolicy.policyVersion = 2; }],
    ["fingerprint changed", (s) => { s.submission.sourceFingerprint = "b".repeat(64); }],
    ["snapshot fingerprint changed", (s) => { s.submission.evidenceSnapshot.fingerprint = "b".repeat(64); }],
    ["snapshot checksum changed", (s) => { s.submission.evidenceSnapshot.checksum = "b".repeat(64); }],
    ["snapshot organisation policy changed", (s) => { s.submission.evidenceSnapshot.organisationPolicyVersion = 2; }],
    ["snapshot facility policy changed", (s) => { s.submission.evidenceSnapshot.facilityPolicyVersion = 2; }],
    ["source kind downgraded", (s) => { s.submission.evidenceSnapshot.sourceKind = "ORDINARY_STUDIO"; }],
    ["snapshot facility changed", (s) => { s.submission.evidenceSnapshot.facilityId = "other-facility"; }],
    ["snapshot revision changed", (s) => { s.submission.evidenceSnapshot.revision = 2; }]
  ]) {
    const state = fixture();
    mutate(state);
    await rejectsSource(state).catch((error) => { error.message = `${label}: ${error.message}`; throw error; });
  }
});

test("C4 output remains exact, private, ready and attached to an active owned promo", async () => {
  for (const [label, mutate] of [
    ["output media unavailable", (s) => { s.render.outputMediaAsset.status = "DELETED"; }],
    ["output media foreign", (s) => { s.render.outputMediaAsset.organisationId = "foreign-org"; }],
    ["output promo media changed", (s) => { s.render.outputPromoVersion.mediaAssetId = "other-media"; }],
    ["output promo foreign", (s) => { s.render.outputPromoVersion.promoAsset.organisationId = "foreign-org"; }],
    ["output promo archived", (s) => { s.render.outputPromoVersion.promoAsset.status = "ARCHIVED"; }],
    ["output promo globally approved", (s) => { s.render.outputPromoVersion.status = "APPROVED"; }]
  ]) {
    const state = fixture();
    mutate(state);
    await rejectsSource(state).catch((error) => { error.message = `${label}: ${error.message}`; throw error; });
  }
});

test("C4 source take must remain current even for an older pinned distribution", async () => {
  for (const mutate of [
    (s) => { s.takes[0].status = "DELETED"; },
    (s) => { s.takes[0].trashedAt = new Date(); },
    (s) => { s.takes[0].mediaAsset.organisationId = "foreign-org"; },
    (s) => { s.takes[0].promoVersion.status = "SUPERSEDED"; },
    (s) => { s.takes[0].promoVersion.promoAsset.currentApprovedVersionId = "new-source-promo"; }
  ]) {
    const state = fixture();
    state.programme.latestRevision = 2;
    mutate(state);
    await rejectsSource(state, true);
  }
});

test("target policy still blocks restricted genre and foreign facility for a valid C4 source", async () => {
  const state = fixture();
  const { result } = await sourceFor(state);
  assert.equal(service.assertCorrectionsNetworkTarget(state.organisationId, result, state.facilityPolicy), state.facilityPolicy);
  const blocked = structuredClone(state.facilityPolicy);
  blocked.restrictedGenres = ["ROCK"];
  result.sourceMedia[0].genres = [{ mediaGenre: { slug: "rock" } }];
  assert.throws(() => service.assertCorrectionsNetworkTarget(state.organisationId, result, blocked),
    (error) => error?.status === 409 && /CORRECTIONS_GENRE_RESTRICTED/.test(error.message));
  const foreign = structuredClone(state.facilityPolicy);
  foreign.location.organisationId = "foreign-org";
  assert.throws(() => service.assertCorrectionsNetworkTarget(state.organisationId, result, foreign),
    (error) => error?.status === 409);
});
