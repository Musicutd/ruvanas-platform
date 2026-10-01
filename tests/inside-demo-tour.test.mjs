import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { insideDemoFacilities } from "../lib/inside-demo-scenario.mjs";
import { applyInsideDemoReview, initialInsideDemoReview } from "../lib/inside-demo-review.mjs";

test("Inside public tour uses only the three fictional seeded facilities", () => {
  assert.equal(insideDemoFacilities.length, 3);
  assert.equal(new Set(insideDemoFacilities.map((item) => item.slug)).size, 3);
  assert.ok(insideDemoFacilities.every((item) => item.name.startsWith("Synthetic Facility ") && item.zone.startsWith("Synthetic ")));
  assert.deepEqual(insideDemoFacilities.filter((item) => item.draft).map((item) => item.draft), ["Synthetic orientation programme"]);
});

test("Inside tour is DEMO-only and cannot expose an operational API", () => {
  const page = readFileSync(new URL("../app/inside-demo/page.js", import.meta.url), "utf8");
  const walkthrough = readFileSync(new URL("../app/inside-demo/ReviewWalkthrough.js", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
  const seed = readFileSync(new URL("../scripts/seed-inside-demo.mjs", import.meta.url), "utf8");
  assert.match(page, /process\.env\.RUVANAS_ENVIRONMENT !== "DEMO"\) notFound\(\)/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.doesNotMatch(page, /fetch\(|prisma|\/api\/|<form|<button/);
  assert.doesNotMatch(walkthrough, /fetch\(|prisma|\/api\/|<form|localStorage|sessionStorage/);
  assert.match(walkthrough, /browser-only/);
  assert.match(page, /href="#review-example"/);
  assert.match(walkthrough, /id="review-example"/);
  assert.match(walkthrough, /contributors cannot see staff approval controls/);
  assert.match(home, /demoMode \? "\/inside-demo" : "\/register\/free-access"/);
  assert.match(seed, /for \(const \{ slug, name, zone, draft \} of insideDemoFacilities\)/);
  assert.doesNotMatch(seed, /const draft\s*=/);
});

test("fictional review preserves the exact first version when staff request changes", () => {
  const draft = initialInsideDemoReview();
  assert.equal(applyInsideDemoReview(draft, "APPROVE"), draft);
  const submitted = applyInsideDemoReview(draft, "SUBMIT");
  assert.equal(submitted.status, "PENDING_REVIEW");
  assert.equal(submitted.history[0].renderId, "SYNTHETIC-RENDER-001");
  const changes = applyInsideDemoReview(submitted, "REQUEST_CHANGES");
  assert.equal(applyInsideDemoReview(changes, "APPROVE"), changes);
  const resubmitted = applyInsideDemoReview(changes, "SUBMIT");
  assert.equal(resubmitted.revision, 2);
  assert.equal(resubmitted.history[0].renderId, "SYNTHETIC-RENDER-001");
  assert.equal(resubmitted.history.at(-1).renderId, "SYNTHETIC-RENDER-002");
  const approved = applyInsideDemoReview(resubmitted, "APPROVE");
  assert.equal(approved.status, "APPROVED");
  assert.match(approved.history.at(-1).label, /nothing is scheduled/);
  assert.equal(applyInsideDemoReview(approved, "SUBMIT"), approved);
  assert.deepEqual(applyInsideDemoReview(approved, "RESET"), initialInsideDemoReview());
});

test("fictional staff rejection leaves the submitted version in history", () => {
  const submitted = applyInsideDemoReview(initialInsideDemoReview(), "SUBMIT");
  const rejected = applyInsideDemoReview(submitted, "REJECT");
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.history[0].renderId, rejected.history[1].renderId);
  assert.equal(applyInsideDemoReview(rejected, "APPROVE"), rejected);
});
