import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCampaignProof,
  campaignProofCsv,
  normaliseCampaignProofFilters,
  reportUtcQueryWindow
} from "../lib/campaign-proof-report.mjs";

function intent(id, overrides = {}) {
  return {
    id,
    scheduleItemId: `${id}-schedule`,
    campaignId: "campaign-1",
    campaign: { name: "Lunch offer" },
    promoVersionId: "version-1",
    promoVersion: { version: 3, promoAsset: { name: "Lunch promo" } },
    locationId: "location-1",
    locationName: "Valletta flagship",
    locationTimezone: "Europe/Malta",
    locationGroups: [{ id: "group-north", name: "North" }],
    plannedStart: new Date("2026-08-27T08:05:00.000Z"),
    ...overrides
  };
}

test("campaign proof aggregates unique intent outcomes by campaign, location, group, date, and hour", () => {
  const intents = [
    intent("intent-1", { locationGroups: [{ id: "group-north", name: "North" }, { id: "group-flagship", name: "Flagships" }] }),
    intent("intent-2", { plannedStart: new Date("2026-08-27T08:35:00.000Z") })
  ];
  const events = [
    { playoutIntentId: "intent-1", scheduleItemId: "intent-1-schedule", eventType: "STARTED" },
    { playoutIntentId: "intent-1", scheduleItemId: "intent-1-schedule", eventType: "COMPLETED" },
    { playoutIntentId: "intent-2", scheduleItemId: "intent-2-schedule", eventType: "STARTED" },
    { playoutIntentId: "intent-2", scheduleItemId: "intent-2-schedule", eventType: "FAILED" }
  ];
  const report = aggregateCampaignProof({ intents, events, filters: { from: "2026-08-27", to: "2026-08-27" } });
  assert.deepEqual(report.summary, {
    planned: 2,
    started: 2,
    completed: 1,
    failed: 1,
    awaitingConfirmation: 0,
    completionRate: 0.5,
    metricBasis: "device-confirmed playback",
    audienceMeasurement: false
  });
  const north = report.rows.find((row) => row.locationGroupId === "group-north");
  const flagship = report.rows.find((row) => row.locationGroupId === "group-flagship");
  assert.equal(north.planned, 2);
  assert.equal(north.completed, 1);
  assert.equal(north.failed, 1);
  assert.equal(flagship.planned, 1);
});

test("location-group filters do not double-count summary metrics", () => {
  const report = aggregateCampaignProof({
    intents: [intent("intent-1", { locationGroups: [{ id: "group-north", name: "North" }, { id: "group-flagship", name: "Flagships" }] })],
    events: [{ playoutIntentId: "intent-1", eventType: "COMPLETED" }],
    filters: { from: "2026-08-27", to: "2026-08-27", locationGroupId: "group-flagship" }
  });
  assert.equal(report.summary.planned, 1);
  assert.equal(report.summary.completed, 1);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].locationGroupName, "Flagships");
});

test("report filters are bounded and expand UTC queries across timezone edges", () => {
  assert.throws(() => normaliseCampaignProofFilters({ from: "2026-01-01", to: "2026-05-01" }), /limited to 93 days/);
  assert.throws(() => normaliseCampaignProofFilters({ from: "2026-08-28", to: "2026-08-27" }), /must not be after/);
  const window = reportUtcQueryWindow(normaliseCampaignProofFilters({ from: "2026-08-27", to: "2026-08-27" }));
  assert.equal(window.from.toISOString(), "2026-08-26T10:00:00.000Z");
  assert.equal(window.until.toISOString(), "2026-08-28T14:00:00.000Z");
});

test("CSV labels device-confirmed evidence and neutralises spreadsheet formulas", () => {
  const report = aggregateCampaignProof({
    intents: [intent("intent-1", { campaign: { name: "=unsafe campaign" } })],
    events: [],
    filters: { from: "2026-08-27", to: "2026-08-27" }
  });
  const csv = campaignProofCsv(report);
  assert.match(csv, /"Metric basis","Audience measured"/);
  assert.match(csv, /"device-confirmed playback","No"/);
  assert.match(csv, /"'=unsafe campaign"/);
  assert.doesNotMatch(csv, /listener|reach/i);
});

