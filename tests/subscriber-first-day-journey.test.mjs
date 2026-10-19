import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildOnlineRadioProductOnboarding } from "../lib/product-onboarding.mjs";

test("a new radio subscriber sees their task separately from Ruvanas stream setup", () => {
  const newAccount = buildOnlineRadioProductOnboarding({ membershipRole: "OWNER" });
  assert.equal(newAccount.nextStepId, "STATION");
  assert.equal(newAccount.nextAction.label, "Create station");

  const waiting = buildOnlineRadioProductOnboarding({ membershipRole: "OWNER", firstStationId: "station-1" });
  assert.equal(waiting.nextStepId, "STREAM");
  assert.equal(waiting.steps.find((step) => step.status === "CURRENT").owner, "Ruvanas Super Admin");
  assert.match(waiting.nextAction.description, /You do not need to enter provider details/);

  const readyForMusic = buildOnlineRadioProductOnboarding({ membershipRole: "OWNER", firstStationId: "station-1", stationActive: true, streamConfigured: true });
  assert.equal(readyForMusic.nextStepId, "PROGRAMMING");
  assert.equal(readyForMusic.nextAction.href, "/dashboard/programming#workspace-simple");
  assert.equal(readyForMusic.nextAction.label, "Start station music");
});

test("the radio dashboard offers a clear music-to-week workflow while Ruvanas handles setup", async () => {
  const [radio, dashboard, stationForm] = await Promise.all([
    readFile(new URL("../app/dashboard/radio/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/stations/new/page.js", import.meta.url), "utf8")
  ]);
  assert.match(radio, /const quickTasks = \[/);
  for (const label of ["1 · Music library", "2 · Playlists", "3 · Weekly planner"]) assert.ok(radio.includes(`label: "${label}"`));
  assert.match(radio, /product=ONLINE#workspace-library/);
  assert.match(dashboard, /RUVANAS IS HANDLING THIS STEP/);
  assert.match(dashboard, /While Ruvanas prepares your service/);
  assert.doesNotMatch(stationForm, /shop programming/);
});

test("Online planning opens playlists while generic live music keeps optional forms closed", async () => {
  const [page, simple, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/SimplePlaylistWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/simple-playlists.module.css", import.meta.url), "utf8")
  ]);
  assert.match(page, /label: radioPlanning \? "2 · Playlists" : "AutoDJ & playlists"/);
  assert.match(page, /label: radioPlanning \? "3 · Weekly planner" : "Weekly planner"/);
  assert.match(page, /onlineOnly \? "Backup & playback" : "Locations & backup"/);
  assert.match(simple, /Playlists and timed slots below are optional/);
  assert.match(simple, /Ask Ruvanas to prepare your station channel/);
  assert.doesNotMatch(simple, /Create a channel first/);
  assert.equal((simple.match(/<details className=\{styles\.taskDetails\}>/g) || []).length, 1);
  assert.match(simple, /<details className=\{styles\.taskDetails\} open=\{planningOnly \|\| undefined\}>/);
  assert.match(simple, /!sandboxDraftOnly && !planningOnly && data\.canSchedule !== false/);
  assert.match(simple, /disclosure\.open = true/);
  assert.match(simple, /Choose when a playlist plays/);
  assert.match(styles, /\.taskDetails > summary:focus-visible/);
});
