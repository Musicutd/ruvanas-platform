import test from "node:test";
import assert from "node:assert/strict";
import {
  aiArtifactProvenance,
  assertAIReviewTransition,
  assertProviderDataPolicy,
  generateGovernedDraft,
  normalizeAssistantRequest,
  normalizeHumanReview
} from "../lib/ai-governance.mjs";

const request = {
  assistantType: "PROMO_SCRIPT",
  dataClassification: "CUSTOMER_CONTENT",
  title: "Weekend offer",
  audience: "Retail visitors",
  brief: "Invite customers to discover the verified weekend promotion.",
  callToAction: "Ask a team member for details.",
  tone: "friendly",
  durationSeconds: 30
};

test("assistant requests are normalized and bounded", () => {
  const normalized = normalizeAssistantRequest(request);
  assert.equal(normalized.assistantType, "PROMO_SCRIPT");
  assert.equal(normalized.durationSeconds, 30);
  assert.throws(() => normalizeAssistantRequest({ ...request, durationSeconds: 5 }), /between 10 and 3600/);
  assert.throws(() => normalizeAssistantRequest({ ...request, assistantType: "AUTO_PUBLISH" }), /supported assistant/);
});

test("retail promo drafts remain editable review artifacts", () => {
  const draft = generateGovernedDraft(request);
  assert.match(draft, /DRAFT PROMO SCRIPT/);
  assert.match(draft, /verify every offer/);
  assert.match(draft, /Ask a team member/);
});

test("school drafts carry staff review and safeguarding reminders", () => {
  const draft = generateGovernedDraft({ ...request, assistantType: "SCHOOL_SCRIPT", dataClassification: "SCHOOL_CONTENT", audience: "Students aged 12 to 14" });
  assert.match(draft, /DRAFT SCHOOL RADIO SCRIPT/);
  assert.match(draft, /safeguarding, consent, accuracy and age-appropriateness/);
});

test("local templates do not claim external data sharing", () => {
  assert.deepEqual(assertProviderDataPolicy({ providerKey: "RUVANAS_TEMPLATE_V1", dataClassification: "SCHOOL_STUDENT_DATA" }), { privateDataSent: false, providerDataUseApproved: false });
});

test("external providers require approved terms and cannot receive private student data", () => {
  assert.throws(() => assertProviderDataPolicy({ providerKey: "THIRD_PARTY", dataClassification: "INTERNAL" }), /terms must be approved/);
  assert.throws(() => assertProviderDataPolicy({ providerKey: "THIRD_PARTY", dataClassification: "SCHOOL_STUDENT_DATA", providerDataUseApproved: true }), /student data cannot be sent/);
  assert.deepEqual(assertProviderDataPolicy({ providerKey: "THIRD_PARTY", dataClassification: "CUSTOMER_CONTENT", providerDataUseApproved: true }), { privateDataSent: true, providerDataUseApproved: true });
});

test("review transitions are terminal and have no publish state", () => {
  assert.equal(assertAIReviewTransition("NEEDS_REVIEW", "APPROVED"), "APPROVED");
  assert.equal(assertAIReviewTransition("NEEDS_REVIEW", "REJECTED"), "REJECTED");
  assert.throws(() => assertAIReviewTransition("APPROVED", "NEEDS_REVIEW"), /cannot move/);
  assert.throws(() => assertAIReviewTransition("NEEDS_REVIEW", "PUBLISHED"), /cannot move/);
});

test("approval preserves the human-edited artifact while rejection stores no approved text", () => {
  assert.equal(normalizeHumanReview({ decision: "APPROVED", editedText: "Human reviewed and corrected content." }).approvedText, "Human reviewed and corrected content.");
  assert.equal(normalizeHumanReview({ decision: "REJECTED", editedText: "Ignored" }).approvedText, null);
  assert.throws(() => normalizeHumanReview({ decision: "APPROVED", editedText: "short" }), /Approved draft/);
});

test("provenance explicitly disables automatic publication", () => {
  const provenance = aiArtifactProvenance({ assistantType: "PROMO_SCRIPT", dataClassification: "INTERNAL" });
  assert.equal(provenance.humanReviewRequired, true);
  assert.equal(provenance.autoPublishAllowed, false);
  assert.equal(provenance.privateDataSent, false);
});

