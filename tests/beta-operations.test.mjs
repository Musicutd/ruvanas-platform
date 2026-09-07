import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertBetaTransition,
  betaFeedbackVisibility,
  betaOperationsSummary,
  betaParticipantDecision,
  normalizeBetaFeedback,
  normalizeBetaParticipant,
  normalizeBetaProgramme
} from "../lib/beta-operations.mjs";
import { buildAdminNavigation, buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("beta programme input is bounded and dates remain coherent", () => {
  const result = normalizeBetaProgramme({ name: "  Malta   retail beta ", description: "Controlled cohort", maxOrganisations: 20, startsAt: "2026-09-08T09:00:00.000Z", endsAt: "2026-10-08T09:00:00.000Z" });
  assert.equal(result.name, "Malta retail beta");
  assert.equal(result.maxOrganisations, 20);
  assert.equal(result.startsAt.toISOString(), "2026-09-08T09:00:00.000Z");
  assert.throws(() => normalizeBetaProgramme({ name: "No", maxOrganisations: 20 }), /three/);
  assert.throws(() => normalizeBetaProgramme({ name: "Valid beta", maxOrganisations: 0 }), /between 1 and 500/);
  assert.throws(() => normalizeBetaProgramme({ name: "Valid beta", maxOrganisations: 5, startsAt: "2026-10-08", endsAt: "2026-09-08" }), /after/);
});

test("beta participation requires existing product access and preserves billing state", () => {
  assert.deepEqual(normalizeBetaParticipant({ programmeId: "programme-1", organisationId: "organisation-1", product: "online", internalNote: "Radio cohort" }), { programmeId: "programme-1", organisationId: "organisation-1", product: "ONLINE", internalNote: "Radio cohort" });
  const programme = { id: "programme-1", status: "ACTIVE", maxOrganisations: 2 };
  const organisation = { subscription: { id: "subscription-1" }, entitlements: { serviceEnabled: true, retailRadioEnabled: true, schoolRadioEnabled: false, onlineRadioEnabled: false } };
  assert.equal(betaParticipantDecision({ programme, organisation, product: "RETAIL", activeCount: 1 }).ok, true);
  assert.equal(betaParticipantDecision({ programme, organisation, product: "ONLINE", activeCount: 1 }).ok, false);
  assert.equal(betaParticipantDecision({ programme, organisation, product: "RETAIL", activeCount: 2 }).status, 409);
  assert.equal(betaParticipantDecision({ programme: { ...programme, status: "CLOSED" }, organisation, product: "RETAIL", activeCount: 0 }).ok, false);
});

test("subscriber beta feedback is structured, bounded and safely visible", () => {
  assert.deepEqual(normalizeBetaFeedback({ participantId: "participant-1", category: "usability", severity: "normal", rating: 4, subject: "  Clearer   setup ", description: "The first player setup needs a clearer explanation for a new operator." }), {
    participantId: "participant-1",
    category: "USABILITY",
    severity: "NORMAL",
    rating: 4,
    subject: "Clearer setup",
    description: "The first player setup needs a clearer explanation for a new operator."
  });
  assert.throws(() => normalizeBetaFeedback({ participantId: "p", category: "UNKNOWN", severity: "NORMAL", subject: "Feedback", description: "This description is sufficiently long for the test." }), /category/);
  assert.throws(() => normalizeBetaFeedback({ participantId: "p", category: "OTHER", severity: "NORMAL", rating: 7, subject: "Feedback", description: "This description is sufficiently long for the test." }), /1 to 5/);
  assert.deepEqual(betaFeedbackVisibility({ membershipRole: "OWNER", userId: "owner" }), {});
  assert.deepEqual(betaFeedbackVisibility({ membershipRole: "VIEWER", userId: "viewer" }), { createdByUserId: "viewer" });
});

test("beta status transitions fail closed", () => {
  assert.equal(assertBetaTransition("programme", "DRAFT", "ACTIVE"), true);
  assert.equal(assertBetaTransition("participant", "PAUSED", "ACTIVE"), true);
  assert.equal(assertBetaTransition("feedback", "RESOLVED", "IN_PROGRESS"), true);
  assert.throws(() => assertBetaTransition("programme", "CLOSED", "ACTIVE"), /cannot move/);
  assert.throws(() => assertBetaTransition("participant", "REMOVED", "ACTIVE"), /cannot move/);
  assert.throws(() => assertBetaTransition("feedback", "CLOSED", "TRIAGED"), /cannot move/);
});

test("beta summary counts actionable records", () => {
  assert.deepEqual(betaOperationsSummary([{ status: "ACTIVE", participants: [{ status: "ACTIVE" }, { status: "PAUSED" }], feedback: [{ status: "NEW", severity: "BLOCKER" }, { status: "RESOLVED", severity: "BLOCKER" }] }]), { activeProgrammes: 1, activeParticipants: 1, openFeedback: 1, blockers: 1 });
});

test("beta navigation is invitation-aware and administration stays role controlled", () => {
  const ordinary = buildSubscriberNavigation({ entitlements: { serviceEnabled: true, retailRadioEnabled: true }, betaActive: false }).flatMap((section) => section.items);
  const participant = buildSubscriberNavigation({ entitlements: { serviceEnabled: true, retailRadioEnabled: true }, betaActive: true }).flatMap((section) => section.items);
  assert.ok(!ordinary.some((item) => item.id === "beta"));
  assert.equal(participant.find((item) => item.id === "beta")?.href, "/dashboard/beta");
  assert.ok(buildAdminNavigation("SUPPORT").flatMap((section) => section.items).some((item) => item.href === "/admin/beta"));
});

test("beta routes enforce access, auditing and the no-billing boundary", async () => {
  const [adminRoute, subscriberRoute, dashboard, adminClient, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/admin/beta/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/beta/feedback/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/beta/BetaFeedbackWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/beta/BetaOperationsCentre.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261028000000_stage_30a_controlled_beta_operations/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(adminRoute, /requirePlatformAdmin/);
  assert.match(adminRoute, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(adminRoute, /BETA_PARTICIPANT_ADMITTED/);
  assert.match(adminRoute, /billingChanged: false/);
  assert.match(subscriberRoute, /programme: \{ status: "ACTIVE" \}/);
  assert.match(subscriberRoute, /hasSubscriberProduct/);
  assert.match(subscriberRoute, /recentCount >= 5/);
  assert.match(subscriberRoute, /BETA_FEEDBACK_SUBMITTED/);
  assert.doesNotMatch(`${adminRoute}\n${subscriberRoute}`, /billing(?:Contract|Invoice)\.(?:create|update|delete)/);
  assert.match(dashboard, /Do not include passwords/);
  assert.match(adminClient, /No billing changes/);
  assert.match(schema, /model BetaProgramme/);
  assert.match(schema, /model BetaParticipant/);
  assert.match(schema, /model BetaFeedback/);
  assert.match(migration, /ON DELETE CASCADE/);
});
