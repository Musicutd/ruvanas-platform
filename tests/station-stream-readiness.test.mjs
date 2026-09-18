import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildOnlineRadioProductOnboarding } from "../lib/product-onboarding.mjs";

test("a created station waits for Ruvanas stream activation instead of prompting its owner for credentials", () => {
  const journey = buildOnlineRadioProductOnboarding({ membershipRole: "OWNER", firstStationId: "station-1", stationActive: false, streamConfigured: false });
  assert.equal(journey.steps.find((step) => step.id === "STATION").complete, true);
  assert.equal(journey.nextStepId, "STREAM");
  assert.equal(journey.nextAction.label, "View setup status");
  assert.equal(journey.nextAction.href, "/stations/station-1/setup");
  assert.equal(journey.steps.find((step) => step.id === "STREAM").owner, "Ruvanas Super Admin");
});

test("streaming credentials and activation are Super Admin only, with a live-audio gate", async () => {
  const [subscriberPage, adminPage, setupRoute, activationRoute, adminForm] = await Promise.all([
    readFile(new URL("../app/stations/[stationId]/setup/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/stations/[stationId]/setup/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/setup/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/stations/[stationId]/activate/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/stations/[stationId]/setup/AdminStationSetupForm.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(subscriberPage, /centovaUsername|sourcePassword|adminPassword|serverPort|<form/);
  assert.match(adminPage, /role !== "SUPER_ADMIN"/);
  assert.match(setupRoute, /role !== "SUPER_ADMIN"/);
  assert.match(activationRoute, /role !== "SUPER_ADMIN"/);
  assert.match(activationRoute, /probeStationStream/);
  assert.match(activationRoute, /probe.status !== "HEALTHY"/);
  assert.match(activationRoute, /subscriberProductAccess/);
  assert.match(activationRoute, /STATION_ACTIVATED_AFTER_STREAM_PROBE/);
  assert.match(adminForm, /Check stream and activate station/);
});

test("public player preview is unavailable until activation and publication", async () => {
  const settings = await readFile(new URL("../app/stations/[stationId]/public-player/PublicPlayerSettings.js", import.meta.url), "utf8");
  assert.match(settings, /station.status === "ACTIVE" && published/);
  assert.match(settings, /Preview available after station activation and publication/);
  assert.match(settings, /setPublished\(enabled\)/);
});
