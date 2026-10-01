import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { insideDemoFacilities } from "../lib/inside-demo-scenario.mjs";

test("Inside public tour uses only the three fictional seeded facilities", () => {
  assert.equal(insideDemoFacilities.length, 3);
  assert.equal(new Set(insideDemoFacilities.map((item) => item.slug)).size, 3);
  assert.ok(insideDemoFacilities.every((item) => item.name.startsWith("Synthetic Facility ") && item.zone.startsWith("Synthetic ")));
  assert.deepEqual(insideDemoFacilities.filter((item) => item.draft).map((item) => item.draft), ["Synthetic orientation programme"]);
});

test("Inside tour is DEMO-only and cannot expose an operational API", () => {
  const page = readFileSync(new URL("../app/inside-demo/page.js", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
  const seed = readFileSync(new URL("../scripts/seed-inside-demo.mjs", import.meta.url), "utf8");
  assert.match(page, /process\.env\.RUVANAS_ENVIRONMENT !== "DEMO"\) notFound\(\)/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.doesNotMatch(page, /fetch\(|prisma|\/api\/|<form|<button/);
  assert.match(home, /demoMode \? "\/inside-demo" : "\/register\/free-access"/);
  assert.match(seed, /for \(const \{ slug, name, zone, draft \} of insideDemoFacilities\)/);
  assert.doesNotMatch(seed, /const draft\s*=/);
});
