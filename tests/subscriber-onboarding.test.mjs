import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSubscriberOnboarding } from "../lib/subscriber-onboarding.mjs";

function statusMap(result) {
  return Object.fromEntries(result.steps.map((step) => [step.id, step.status]));
}

test("first-use progress follows real setup evidence in order", () => {
  const onboarding = buildSubscriberOnboarding({
    membershipRole: "OWNER",
    firstStationId: "station-1",
    stationReady: true,
    activeLocationCount: 1,
    activeMusicModeCount: 1,
    publishedScheduleCount: 0,
    configuredPlayerCount: 1,
    activePlayerStreams: 0
  });

  assert.deepEqual(statusMap(onboarding), {
    STATION: "COMPLETE",
    LOCATION: "COMPLETE",
    PROGRAMME: "CURRENT",
    PLAYER: "COMPLETE",
    PLAYBACK: "UPCOMING"
  });
  assert.equal(onboarding.completedCount, 3);
  assert.equal(onboarding.nextStepId, "PROGRAMME");
  assert.equal(onboarding.nextAction.href, "/dashboard/notifications");
});

test("music programming requires an active mode and published schedule", () => {
  const withoutMode = buildSubscriberOnboarding({ activeMusicModeCount: 0, publishedScheduleCount: 1 });
  const withoutSchedule = buildSubscriberOnboarding({ activeMusicModeCount: 1, publishedScheduleCount: 0 });
  const ready = buildSubscriberOnboarding({ activeMusicModeCount: 1, publishedScheduleCount: 1 });

  assert.equal(withoutMode.steps.find((step) => step.id === "PROGRAMME").complete, false);
  assert.equal(withoutSchedule.steps.find((step) => step.id === "PROGRAMME").complete, false);
  assert.equal(ready.steps.find((step) => step.id === "PROGRAMME").complete, true);
});

test("completed setup directs the subscriber to live sessions", () => {
  const onboarding = buildSubscriberOnboarding({
    membershipRole: "MANAGER",
    firstStationId: "station-1",
    stationReady: true,
    activeLocationCount: 1,
    activeMusicModeCount: 1,
    publishedScheduleCount: 1,
    configuredPlayerCount: 1,
    activePlayerStreams: 1
  });

  assert.equal(onboarding.complete, true);
  assert.equal(onboarding.completedCount, 5);
  assert.equal(onboarding.nextStepId, null);
  assert.equal(onboarding.nextAction.href, "/dashboard/player-sessions");
  assert.match(onboarding.nextAction.title, /radio is running/i);
});

test("disabled service sends the user to bounded service guidance", () => {
  const onboarding = buildSubscriberOnboarding({ serviceEnabled: false });
  assert.equal(onboarding.nextAction.href, "/dashboard/notifications");
  assert.match(onboarding.nextAction.eyebrow, /attention/i);
});

test("view-only members are not told they can configure a player", () => {
  const onboarding = buildSubscriberOnboarding({ membershipRole: "VIEWER" });
  const station = onboarding.steps.find((step) => step.id === "STATION");
  const player = onboarding.steps.find((step) => step.id === "PLAYER");
  assert.equal(station.owner, "Owner or manager");
  assert.equal(station.actionLabel, "Check notifications");
  assert.equal(onboarding.nextAction.label, "Check notifications");
  assert.equal(player.owner, "Owner or manager");
  assert.equal(player.actionLabel, "View player status");
});

test("onboarding and contextual help are keyboard-native and responsive", async () => {
  const [checklist, checklistStyles, help, interfaceStyles] = await Promise.all([
    readFile(new URL("../app/components/OnboardingChecklist.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/onboarding-checklist.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ContextHelp.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/interface-patterns.module.css", import.meta.url), "utf8")
  ]);
  assert.match(checklist, /<details/);
  assert.match(checklist, /<summary>/);
  assert.match(checklist, /aria-current/);
  assert.match(help, /<details/);
  assert.match(help, /<summary>/);
  assert.match(checklistStyles, /:focus-visible/);
  assert.match(checklistStyles, /@media \(max-width: 580px\)/);
  assert.match(interfaceStyles, /contextHelp > summary:focus-visible/);
});
