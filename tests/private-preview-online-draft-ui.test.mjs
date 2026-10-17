import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("owner explicitly selects draft access, defaults to read-only and locks its pillar to Online", async () => {
  const ui = await source("app/admin/private-preview/TesterControls.js");
  assert.match(ui, /const \[accessMode, setAccessMode\] = useState\("READ_ONLY"\)/);
  assert.match(ui, /value="READ_ONLY">Read-only/);
  assert.match(ui, /value="ONLINE_DRAFT">Editable Online Radio drafts only/);
  assert.match(ui, /pillars: accessMode === "ONLINE_DRAFT" \? \["ONLINE"\] : pillars, accessMode/);
  assert.match(ui, /disabled=\{working \|\| accessMode === "ONLINE_DRAFT"\}/);
  assert.match(ui, /change of workspace access, signs this tester out/);
  assert.match(ui, /accessMode: result\.tester\.accessMode/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|console\./);
});

test("station creation receives a server-checked mode and a read-only tester never gets the form", async () => {
  const [page, client] = await Promise.all([source("app/stations/new/page.js"), source("app/stations/new/NewStationClient.js")]);
  assert.match(page, /getActiveOrganisationContext\(\{ subscription: \{ include: \{ plan: true \} \} \}\)/);
  assert.match(page, /isPrivatePreviewTester\(context\.user, readPrivatePreviewPolicy\(\)\)/);
  assert.match(page, /\? previewTesterAccessMode\(context\.membership\?\.organisation\?\.subscription\?\.plan\) \|\| "READ_ONLY"\s*: null/);
  assert.match(client, /previewAccessMode = null/);
  assert.match(client, /if \(readOnly\) return/);
  assert.match(client, /\{!readOnly \? <form/);
  assert.match(client, /This creates no streaming infrastructure or live broadcast/);
  assert.match(client, /Save private test station/);
});

test("tester landing and subscriber shell distinguish draft workspace from read-only access", async () => {
  for (const path of ["app/dashboard/layout.js", "app/preview-dashboard/page.js"]) {
    const ui = await source(path);
    assert.match(ui, /previewTesterAccessMode\(/);
    assert.match(ui, /=== "ONLINE_DRAFT"/);
    assert.match(ui, /read-only|Read-only/);
    assert.match(ui, /Live broadcasting, uploads, downloads/);
    assert.match(ui, /paid actions/);
  }
});

test("simple draft editing excludes live controls and keeps playlist save and duplicate", async () => {
  const ui = await source("app/dashboard/programming/SimplePlaylistWorkspace.js");
  assert.match(ui, /const sandboxDraftOnly = data\?\.sandboxDraftOnly === true/);
  assert.match(ui, /const canSchedule = !sandboxDraftOnly && data\?\.canSchedule !== false && data\?\.canManage === true/);
  assert.match(ui, /if \(!data \|\| data\.sandboxDraftOnly === true\) return/);
  assert.match(ui, /!sandboxDraftOnly && <section[^\n]*aria-label="Approved music catalogue"/);
  assert.match(ui, /!sandboxDraftOnly && <section[^\n]*aria-labelledby="nonstop-title"/);
  assert.match(ui, /!sandboxDraftOnly && data\.canSchedule !== false && <details className=\{styles\.taskDetails\}/);
  assert.match(ui, /!sandboxDraftOnly && <button[^\n]*onClick=\{\(\) => archivePlaylist\(item\)\}/);
  assert.match(ui, /async function saveNonStop\(\) \{\s*if \(sandboxDraftOnly \|\| !data\?\.canManage\) return/);
  assert.match(ui, /async function archivePlaylist\(item\) \{\s*if \(sandboxDraftOnly \|\| !data\?\.canManage\) return/);
  assert.match(ui, /onClick=\{savePlaylist\}/);
  assert.match(ui, /onClick=\{\(\) => duplicatePlaylist\(item\)\}/);
});

test("weekly planner saves and previews drafts without publish or take-off-air actions", async () => {
  const ui = await source("app/dashboard/programming/AdvancedSchedulerWorkspace.js");
  assert.match(ui, /const canPublish = data\?\.canPublish === true && !sandboxDraftOnly/);
  assert.match(ui, /preview\?\.conflicts\?\.some\(\(conflict\) => conflict\.severity === "BLOCKING"\) \? "CONFLICTS" : "VALID DRAFT"/);
  assert.match(ui, /async function publish\(scheduleId, versionId\) \{\s*if \(!canPublish\) return/);
  assert.match(ui, /async function archive\(scheduleId\) \{\s*if \(!canPublish\) return/);
  assert.match(ui, /canPublish && schedule\.activeVersion/);
  assert.match(ui, /canPublish && preview\.version\.status === "DRAFT"/);
  assert.match(ui, /onClick=\{\(\) => previewVersion\(schedule\.id, latest\.id\)\}/);
  assert.match(ui, /Create schedule draft/);
  assert.match(ui, /Saving never starts audio/);
});
