import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  betaReviewDecision,
  betaReviewSnapshot,
  buildBetaPortfolioInsights,
  buildBetaProgrammeInsights,
  normalizeBetaReview
} from "../lib/beta-insights.mjs";

function readyProgramme() {
  return {
    id: "programme-1",
    status: "ACTIVE",
    maxOrganisations: 5,
    participants: [
      { id: "participant-1", organisationId: "organisation-1", product: "RETAIL", status: "ACTIVE" },
      { id: "participant-2", organisationId: "organisation-2", product: "ONLINE", status: "ACTIVE" }
    ],
    feedback: [
      { participantId: "participant-1", product: "RETAIL", category: "USABILITY", severity: "NORMAL", status: "RESOLVED", rating: 4, adminResponse: "Resolved." },
      { participantId: "participant-1", product: "RETAIL", category: "FEATURE_REQUEST", severity: "LOW", status: "CLOSED", rating: 5, adminResponse: "Recorded." },
      { participantId: "participant-2", product: "ONLINE", category: "RELIABILITY", severity: "HIGH", status: "TRIAGED", rating: 3, adminResponse: "Investigating." }
    ]
  };
}

test("beta insights aggregate product evidence without customer content", () => {
  const programme = readyProgramme();
  const insights = buildBetaProgrammeInsights(programme);
  assert.equal(insights.readiness, "READY_FOR_DECISION");
  assert.equal(insights.activeOrganisations, 2);
  assert.equal(insights.feedback, 3);
  assert.equal(insights.averageRating, 4);
  assert.equal(insights.responseRate, 100);
  assert.equal(insights.resolutionRate, 67);
  assert.equal(insights.products.find((item) => item.product === "RETAIL").feedback, 2);

  const snapshot = betaReviewSnapshot(insights, programme);
  assert.equal(snapshot.schemaVersion, "stage-30b-v1");
  assert.equal(snapshot.products.length, 5);
  assert.doesNotMatch(JSON.stringify(snapshot), /organisation-1|Resolved\.|Investigating\./);
});

test("open blockers and limited evidence keep cohort expansion closed", () => {
  const programme = readyProgramme();
  programme.feedback = [{ participantId: "participant-1", product: "RETAIL", category: "RELIABILITY", severity: "BLOCKER", status: "NEW", rating: 1 }];
  const insights = buildBetaProgrammeInsights(programme);
  assert.equal(insights.readiness, "BLOCKED");
  assert.equal(insights.openBlockers, 1);
  assert.equal(insights.untriagedFeedback, 1);
  assert.throws(() => betaReviewDecision({ programme, insights, review: { decision: "EXPAND_COHORT", nextCapacity: 10 } }), /readiness findings/);
});

test("beta review decisions produce bounded programme outcomes", () => {
  const programme = readyProgramme();
  const insights = buildBetaProgrammeInsights(programme);
  const expand = normalizeBetaReview({ programmeId: programme.id, decision: "expand_cohort", reviewNote: "The evidence gate is clear and the next cohort can remain controlled.", evidenceReference: "review-2026-09-07", nextCapacity: 10 });
  assert.deepEqual(betaReviewDecision({ programme, insights, review: expand }), { nextStatus: "ACTIVE", nextCapacity: 10 });
  assert.deepEqual(betaReviewDecision({ programme, insights, review: normalizeBetaReview({ programmeId: programme.id, decision: "PAUSE_AND_FIX", reviewNote: "Pause the beta while the team completes the agreed reliability work." }) }), { nextStatus: "PAUSED", nextCapacity: 5 });
  assert.deepEqual(betaReviewDecision({ programme, insights, review: normalizeBetaReview({ programmeId: programme.id, decision: "END_BETA", reviewNote: "Close the controlled programme and retain its evidence for the release record.", evidenceReference: "closure-review" }) }), { nextStatus: "CLOSED", nextCapacity: 5 });
  assert.throws(() => normalizeBetaReview({ programmeId: programme.id, decision: "EXPAND_COHORT", reviewNote: "This note is long enough but evidence is missing.", nextCapacity: 8 }), /evidence reference/);
  assert.throws(() => betaReviewDecision({ programme, insights, review: { decision: "EXPAND_COHORT", nextCapacity: 5 } }), /higher/);
});

test("portfolio insight counts remain aggregate and decision-ready", () => {
  const ready = readyProgramme();
  const paused = { ...readyProgramme(), id: "programme-2", status: "PAUSED", participants: [{ id: "participant-3", organisationId: "organisation-1", product: "SCHOOL", status: "ACTIVE" }], feedback: [] };
  assert.deepEqual(buildBetaPortfolioInsights([ready, paused]), {
    programmes: 2,
    activeProgrammes: 1,
    organisations: 2,
    feedback: 3,
    openBlockers: 0,
    readyProgrammes: 1
  });
});

test("Stage 30B routes and persistence preserve review and billing boundaries", async () => {
  const [route, page, client, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/admin/beta/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/beta/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/beta/BetaOperationsCentre.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261029000000_stage_30b_beta_insights_release_decisions/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(route, /RECORD_REVIEW/);
  assert.match(route, /BETA_RELEASE_DECISION_RECORDED/);
  assert.match(route, /betaReviewSnapshot/);
  assert.match(route, /billingChanged: false/);
  assert.doesNotMatch(route, /billing(?:Contract|Invoice)\.(?:create|update|delete)/);
  assert.match(page, /buildBetaProgrammeInsights/);
  assert.match(client, /Evidence and release decision/);
  assert.match(client, /Feedback text, customer names and contact details are excluded/);
  assert.match(schema, /model BetaProgrammeReview/);
  assert.match(migration, /"snapshot" JSONB NOT NULL/);
  assert.match(migration, /ON DELETE RESTRICT/);
});
