import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all six audio pillars retain focused subscriber dashboards", async () => {
  const pillars = ["retail", "school", "radio", "faith", "health", "organisations"];
  for (const pillar of pillars) {
    const page = await readFile(new URL(`../app/dashboard/${pillar}/page.js`, import.meta.url), "utf8");
    assert.match(page, pillar === "retail" ? /<RetailControlCentre\b/ : /<ProductDashboard\b/, `${pillar} should use its focused subscriber dashboard`);
  }
});

test("setup, numbers and extra tools remain available behind clear disclosures", async () => {
  const [dashboard, homeChecklist] = await Promise.all([
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/OnboardingChecklist.js", import.meta.url), "utf8")
  ]);
  assert.match(dashboard, /heroAction = onboarding && !onboarding\.complete \? onboarding\.nextAction : primaryAction/);
  assert.match(dashboard, /<Link href=\{heroAction\.href\} className=\{styles\.primary\}>/);
  assert.match(dashboard, /<details className=\{styles\.setupDetails\}>/);
  assert.match(dashboard, /onboarding\.steps\.map/);
  assert.match(dashboard, /<details className=\{styles\.metricsDetails\}>/);
  assert.match(dashboard, /metrics\.map/);
  assert.match(dashboard, /quickTasks\.slice\(0, 3\)/);
  assert.match(dashboard, /quickTasks\.slice\(3\)/);
  assert.match(dashboard, /section\.actions\.slice\(0, 4\)/);
  assert.match(dashboard, /section\.actions\.slice\(4\)/);
  assert.match(dashboard, /<WorkspaceTabs/);
  assert.match(homeChecklist, /<details className=\{styles\.guide\} id="first-use-setup">/);
  assert.doesNotMatch(homeChecklist, /open=\{!onboarding\.complete\}/);
});
