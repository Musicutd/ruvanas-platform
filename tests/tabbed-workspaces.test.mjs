import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared workspace tabs are accessible, keyboard operable and preserve visited panels", async () => {
  const [tabs, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/WorkspaceTabs.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/workspace-tabs.module.css", import.meta.url), "utf8")
  ]);

  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /aria-selected/);
  assert.match(tabs, /role="tabpanel"/);
  assert.match(tabs, /ArrowLeft/);
  assert.match(tabs, /ArrowRight/);
  assert.match(tabs, /visited\.has/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});

test("dense subscriber workspaces are split into task-focused tabs", async () => {
  const [productDashboard, programming, school, shell] = await Promise.all([
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/SchoolRadioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/SubscriberPortalShell.js", import.meta.url), "utf8")
  ]);

  assert.match(productDashboard, /<WorkspaceTabs/);
  assert.match(programming, /label="Programming tools"/);
  assert.match(programming, /id: "automation"/);
  assert.match(programming, /id: "live"/);
  assert.match(school, /label="School Radio tools"/);
  assert.match(school, /id: "safety"/);
  assert.match(school, /id: "studio"/);
  assert.match(shell, /expandedSections/);
  assert.match(shell, /aria-controls=\{`subscriber-navigation-/);
});
