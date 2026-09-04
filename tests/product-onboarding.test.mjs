import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildOnlineRadioProductOnboarding,
  buildRetailProductOnboarding,
  buildSchoolProductOnboarding
} from "../lib/product-onboarding.mjs";

function statusMap(readiness) {
  return Object.fromEntries(readiness.steps.map((step) => [step.id, step.status]));
}

test("Retail Radio onboarding follows location, programming, player and live evidence", () => {
  const readiness = buildRetailProductOnboarding({
    membershipRole: "OWNER",
    activeLocationCount: 1,
    activeMusicModeCount: 1,
    publishedScheduleCount: 1,
    configuredPlayerCount: 0,
    activePlayerStreams: 0
  });

  assert.deepEqual(statusMap(readiness), {
    LOCATION: "COMPLETE",
    PROGRAMMING: "COMPLETE",
    PLAYER: "CURRENT",
    PLAYBACK: "UPCOMING"
  });
  assert.equal(readiness.completedCount, 2);
  assert.equal(readiness.percent, 50);
  assert.equal(readiness.nextAction.href, "/dashboard/players");
  assert.equal(readiness.nextAction.label, "Prepare player");
});

test("School Radio separates client safeguarding preparation from Ruvanas approval", () => {
  const waiting = buildSchoolProductOnboarding({
    membershipRole: "MANAGER",
    schoolProfileReady: true,
    activeSupervisorCount: 1,
    safeguardingStatus: "READY_FOR_REVIEW"
  });
  const safeguarding = waiting.steps.find((step) => step.id === "SAFEGUARDING");

  assert.equal(safeguarding.status, "CURRENT");
  assert.equal(safeguarding.owner, "Ruvanas review");
  assert.equal(safeguarding.actionLabel, "View review status");
  assert.match(safeguarding.detail, /waiting for Ruvanas review/i);
});

test("School Radio is ready only after approved content and controlled playback", () => {
  const readiness = buildSchoolProductOnboarding({
    membershipRole: "OWNER",
    schoolProfileReady: true,
    activeSupervisorCount: 1,
    safeguardingStatus: "APPROVED",
    activeProgrammeCount: 1,
    approvedEpisodeCount: 1,
    activePlayerStreams: 1
  });

  assert.equal(readiness.complete, true);
  assert.equal(readiness.completedCount, 6);
  assert.equal(readiness.percent, 100);
  assert.match(readiness.nextAction.title, /School Radio is ready/i);
});

test("Online Radio requires an active configured station and continuous programming", () => {
  const readiness = buildOnlineRadioProductOnboarding({
    membershipRole: "OWNER",
    firstStationId: "station-1",
    stationActive: true,
    streamConfigured: false,
    activeMusicModeCount: 1,
    publishedScheduleCount: 1
  });

  assert.equal(readiness.nextStepId, "STREAM");
  assert.equal(readiness.nextAction.href, "/stations/station-1/setup");
  assert.equal(readiness.nextAction.label, "Configure streaming");
});

test("viewers receive status actions rather than configuration authority", () => {
  const retail = buildRetailProductOnboarding({ activeLocationCount: 1 });
  const school = buildSchoolProductOnboarding({ schoolProfileReady: true });
  const radio = buildOnlineRadioProductOnboarding({ firstStationId: "station-1", stationActive: true });

  assert.equal(retail.steps.find((step) => step.id === "PROGRAMMING").actionLabel, "View status");
  assert.equal(school.steps.find((step) => step.id === "SUPERVISION").actionLabel, "View status");
  assert.equal(radio.steps.find((step) => step.id === "STREAM").actionLabel, "View status");
});

test("product dashboards and Super Admin organisations render evidence-led progress", async () => {
  const [dashboard, styles, retail, school, radio, organisations] = await Promise.all([
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/product-dashboard.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/retail/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/organisations/page.js", import.meta.url), "utf8")
  ]);

  assert.match(dashboard, /GUIDED LAUNCH/);
  assert.match(dashboard, /<progress/);
  assert.match(dashboard, /aria-current/);
  assert.match(styles, /\.stepCurrent/);
  assert.match(styles, /@media \(max-width: 660px\)/);
  assert.match(retail, /buildRetailProductOnboarding/);
  assert.match(school, /buildSchoolProductOnboarding/);
  assert.match(radio, /buildOnlineRadioProductOnboarding/);
  assert.match(organisations, /Product readiness/);
  assert.match(organisations, /playerListenerLeases/);
  assert.match(organisations, /schoolSafeguardingReadiness/);
});
