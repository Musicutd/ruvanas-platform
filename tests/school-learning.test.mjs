import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSIGNMENT_TEMPLATE_CODES,
  defaultRubricForTemplate,
  normalizeAssessment,
  normalizePortfolioEvidence,
  normalizeRubricCriteria,
  validateAssignmentSubmission
} from "../lib/school-learning.mjs";

test("all approved learning templates create a usable default rubric", () => {
  assert.equal(ASSIGNMENT_TEMPLATE_CODES.length, 10);
  for (const code of ASSIGNMENT_TEMPLATE_CODES) {
    const criteria = defaultRubricForTemplate(code);
    assert.ok(criteria.length >= 3);
    assert.equal(criteria.every((item) => item.maxScore === 10), true);
  }
});

test("rubrics are bounded and assessment totals are calculated from exact criteria", () => {
  const rubric = normalizeRubricCriteria([{ label: "Accuracy", maxScore: 10 }, { label: "Production", maxScore: 20 }], "NEWS_60").map((item, index) => ({ ...item, id: `criterion-${index}` }));
  const assessment = normalizeAssessment({ criteria: rubric, scores: [{ criterionId: "criterion-0", score: 8 }, { criterionId: "criterion-1", score: 17 }], annotations: [{ positionMs: 3000, note: "Tighten this link." }] });
  assert.equal(assessment.totalScore, 25);
  assert.equal(assessment.maximumScore, 30);
  assert.equal(assessment.annotations[0].positionMs, 3000);
  assert.throws(() => normalizeAssessment({ criteria: rubric, scores: [{ criterionId: "criterion-0", score: 11 }, { criterionId: "criterion-1", score: 17 }] }), /between 0 and 10/);
});

test("assignment submission requires an open assignment, contributors, and an artifact", () => {
  assert.deepEqual(validateAssignmentSubmission({ assignmentStatus: "OPEN", contributorIds: ["a", "a", "b"], audioProjectId: "project" }), ["a", "b"]);
  assert.throws(() => validateAssignmentSubmission({ assignmentStatus: "DRAFT", contributorIds: ["a"], episodeId: "episode" }), /only while the assignment is open/);
  assert.throws(() => validateAssignmentSubmission({ assignmentStatus: "OPEN", contributorIds: ["a"] }), /AudioLab project or school episode/);
});

test("portfolio evidence is always private and deduplicates demonstrated skills", () => {
  assert.deepEqual(normalizePortfolioEvidence({ title: "My bulletin", skills: ["Research", "Research", "Editing"] }), { title: "My bulletin", projectRole: null, reflection: null, skills: ["Research", "Editing"], status: "PRIVATE" });
});
