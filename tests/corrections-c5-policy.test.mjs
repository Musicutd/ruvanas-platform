import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CORRECTIONS_DEVELOPMENT_MODULES, CORRECTIONS_REHAB_CATEGORIES,
  correctionsC5Features, correctionsMusicReason, correctionsRequestAllowed, correctionsRequestTransition,
  normalizeCorrectionsRequest, normalizeOnAirText, safeCorrectionsRequestSummary
} from "../lib/corrections-c5-policy.mjs";

test("C5 features fail closed and respect all five Inside tiers", () => {
  assert.equal(correctionsC5Features({ planTierNumber: 5 }).tier, 0);
  const tiers = [1, 2, 3, 4, 5].map((tier) => correctionsC5Features({ correctionsRadioEnabled: true, planTierNumber: tier }));
  assert.deepEqual(tiers.map((item) => item.familyRequests), [false, true, true, true, true]);
  assert.deepEqual(tiers.map((item) => item.rehabilitationManagement), [false, true, true, true, true]);
  assert.deepEqual(tiers.map((item) => item.advanced), [false, false, true, true, true]);
  assert.deepEqual(tiers.map((item) => item.network), [false, false, false, true, true]);
  assert.deepEqual(tiers.map((item) => item.customTaxonomy), [false, false, false, false, true]);
});

test("public requests accept only moderated radio content and minimal identity", () => {
  const basic = { type: "SONG", senderDisplayName: "Family", recipientReference: "local-code", songTitle: "A song", consent: true };
  const item = normalizeCorrectionsRequest(basic, "FAMILY");
  assert.equal(item.source, "FAMILY");
  assert.equal(item.songTitle, "A song");
  assert.throws(() => normalizeCorrectionsRequest({ ...basic, consent: false }, "FAMILY"), /privacy/);
  assert.throws(() => normalizeCorrectionsRequest({ ...basic, type: "PROGRAMME" }, "FAMILY"), /radio requests/);
  assert.throws(() => normalizeCorrectionsRequest({ ...basic, medical: "secret" }, "FAMILY"), /sensitive/);
  assert.throws(() => normalizeCorrectionsRequest({ ...basic, message: "x".repeat(501) }, "FAMILY"), /500/);
  assert.throws(() => normalizeCorrectionsRequest({ ...basic, type: "PROGRAMME" }, "FAMILY"), { status: 400 });
});

test("request validation rejects missing consent, private identifiers and excess text before persistence", () => {
  const form = { type: "MESSAGE", senderDisplayName: "Sender", recipientReference: "ref", message: "Hello", consent: true };
  for (const forbidden of ["offence", "sentence", "medical", "diagnosis", "address", "dateOfBirth", "identityDocument", "prisonNumber"]) {
    assert.throws(() => normalizeCorrectionsRequest({ ...form, [forbidden]: "private" }, "FAMILY"), { status: 400 });
  }
  assert.throws(() => normalizeCorrectionsRequest({ ...form, senderDisplayName: "" }, "FAMILY"), /display name/);
  assert.throws(() => normalizeCorrectionsRequest({ ...form, message: "" }, "FAMILY"), /short message/);
  assert.throws(() => normalizeCorrectionsRequest({ ...form, relationship: 23 }, "FAMILY"), /must be text/);
  assert.throws(() => normalizeCorrectionsRequest({ ...form, message: "Hello\u0001" }, "FAMILY"), /plain-text/);
});

test("internal requests accept programme and rehabilitation suggestions but not unknown types", () => {
  assert.equal(normalizeCorrectionsRequest({ type: "PROGRAMME" }, "INTERNAL").type, "PROGRAMME");
  assert.equal(normalizeCorrectionsRequest({ type: "REHABILITATION_SUGGESTION", message: "Education hour" }, "INTERNAL").source, "INTERNAL");
  assert.throws(() => normalizeCorrectionsRequest({ type: "CHAT" }, "INTERNAL"), /request type/);
});

test("facility request policy controls internal and family modes independently", () => {
  const facility = { requestAvailability: "INTERNAL_ONLY", songRequestsEnabled: true, messageRequestsEnabled: false, dedicationsEnabled: true };
  assert.equal(correctionsRequestAllowed(facility, "INTERNAL", "SONG"), true);
  assert.equal(correctionsRequestAllowed(facility, "FAMILY", "SONG"), false);
  assert.equal(correctionsRequestAllowed(facility, "INTERNAL", "MESSAGE"), false);
  assert.equal(correctionsRequestAllowed({ ...facility, requestAvailability: "FAMILY_AND_INTERNAL" }, "FAMILY", "DEDICATION"), true);
  assert.equal(correctionsRequestAllowed({ ...facility, requestAvailability: "DISABLED" }, "INTERNAL", "SONG"), false);
});

test("music rejection reasons are understandable without exposing implementation codes", () => {
  assert.match(correctionsMusicReason("CORRECTIONS_TRACK_BLOCKED"), /facility has blocked/);
  assert.match(correctionsMusicReason("USE_NOT_PERMITTED"), /licence/);
  assert.doesNotMatch(correctionsMusicReason("UNKNOWN"), /UNKNOWN/);
});

test("review cannot jump to scheduling or playback", () => {
  assert.equal(correctionsRequestTransition({ status: "RECEIVED" }, "APPROVE"), null);
  assert.equal(correctionsRequestTransition({ status: "RECEIVED" }, "SCREEN"), "SCREENING");
  assert.equal(correctionsRequestTransition({ status: "SCREENING" }, "APPROVE"), "APPROVED");
  assert.equal(correctionsRequestTransition({ status: "APPROVED" }, "SCHEDULE"), null);
  assert.equal(correctionsRequestTransition({ status: "APPROVED" }, "PLAYED"), null);
  assert.equal(correctionsRequestTransition({ status: "APPROVED" }, "ARCHIVE"), "ARCHIVED");
  assert.equal(correctionsRequestTransition({ status: "REJECTED" }, "ARCHIVE"), "ARCHIVED");
  assert.equal(correctionsRequestTransition({ status: "ARCHIVED" }, "APPROVE"), null);
  assert.equal(correctionsRequestTransition({ status: "SCREENING" }, "REJECT"), "REJECTED");
});

test("on-air wording and list summaries never inherit private original fields", () => {
  const original = { id: "r", facilityId: "f", source: "FAMILY", type: "MESSAGE", status: "RECEIVED", createdAt: new Date(), recipientReference: "SECRET", originalMessage: "Private", senderDisplayName: "Sender" };
  const summary = safeCorrectionsRequestSummary(original);
  assert.equal(Object.hasOwn(summary, "recipientReference"), false);
  assert.equal(Object.hasOwn(summary, "originalMessage"), false);
  assert.equal(normalizeOnAirText({}).onAirRecipient, null);
  assert.equal(normalizeOnAirText({ onAirRecipient: "First name" }).onAirRecipient, "First name");
});

test("rehabilitation and skills taxonomies are descriptive, not qualifications", () => {
  assert.ok(CORRECTIONS_REHAB_CATEGORIES.includes("Employment"));
  assert.ok(CORRECTIONS_DEVELOPMENT_MODULES.includes("Supervised Broadcasting"));
  assert.equal(CORRECTIONS_DEVELOPMENT_MODULES.some((item) => /certif/i.test(item)), false);
});

test("public intake has no read, schedule or playout API and returns generic receipt", async () => {
  const route = await readFile(new URL("../app/api/public/corrections/requests/route.js", import.meta.url), "utf8");
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function (GET|PATCH|PUT|DELETE)/);
  assert.match(route, /Your request has been received for review/);
  assert.match(route, /consumeRateLimit/);
  assert.doesNotMatch(route, /schedule\.|proofOfPlay|playerCommand|sendEmail|publish/i);
});

test("staff requests cannot claim played or scheduled without the shared delivery guard", async () => {
  const service = await readFile(new URL("../lib/corrections-requests-service.js", import.meta.url), "utf8");
  assert.match(service, /correctionsMusicEligibility/);
  assert.match(service, /organisationId: access\.organisationId/);
  assert.match(service, /facilityId: item\.facilityId/);
  assert.doesNotMatch(service, /status:\s*["'](?:SCHEDULED|PLAYED)["']/);
  assert.match(service, /programme\.status|status: "APPROVED"/);
  assert.match(service, /correctionsRequestDecision\.create/);
  assert.match(service, /createdByUserId/);
});

test("family intake keeps private text out of generic notifications and rotates opaque links", async () => {
  const service = await readFile(new URL("../lib/corrections-requests-service.js", import.meta.url), "utf8");
  assert.match(service, /randomBytes\(24\)\.toString\("base64url"\)/);
  assert.match(service, /facility\.requestAvailability === "FAMILY_AND_INTERNAL"/);
  assert.match(service, /dedupeKey/);
  assert.match(service, /Inside request awaiting review/);
  assert.doesNotMatch(service, /message: normalized\.originalMessage|message: normalized\.recipientReference/);
});

test("rehabilitation is metadata over protected, approved organisation media", async () => {
  const service = await readFile(new URL("../lib/corrections-rehabilitation-service.js", import.meta.url), "utf8");
  assert.match(service, /libraryType: "ORGANISATION_PROMO"/);
  assert.match(service, /promoVersions: \{ some: \{ status: "APPROVED", qcStatus: "PASSED" \} \}/);
  assert.match(service, /programme\.status !== "DRAFT"/);
  assert.doesNotMatch(service, /schedule\.create|proofOfPlayEvent\.create/);
});

test("contributors have read-only evidence; only staff can change milestone decisions", async () => {
  const route = await readFile(new URL("../app/api/corrections/contributors/[contributorId]/development/route.js", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/corrections-development-service.js", import.meta.url), "utf8");
  assert.match(route, /correctionsRequestContext/);
  assert.match(service, /developmentAuthority\(tx, access, contributor, \{ edit: true \}\)/);
  assert.match(service, /member\.role !== "MANAGER"/);
  assert.match(service, /CORRECTIONS_DEVELOPMENT_RECORD_CHANGED/);
  assert.match(service, /canEdit: access\.context\.membership\.role/);
});
