import test from "node:test";
import assert from "node:assert/strict";
import {
  adminAnalyticsPeriod,
  adminManagementCsv,
  analyticsChange,
  buildAdminDailySeries,
  classifyServiceFamily,
  normaliseAdminAnalyticsRange,
  sumAdminAnalyticsSeries
} from "../lib/admin-analytics.mjs";

test("admin analytics accepts only controlled reporting ranges", () => {
  assert.equal(normaliseAdminAnalyticsRange("7"), 7);
  assert.equal(normaliseAdminAnalyticsRange(90), 90);
  assert.equal(normaliseAdminAnalyticsRange("365"), 14);
  assert.equal(normaliseAdminAnalyticsRange("invalid"), 14);
  const period = adminAnalyticsPeriod(7, new Date("2026-09-03T10:30:00.000Z"));
  assert.equal(period.currentStart.toISOString(), "2026-08-28T00:00:00.000Z");
  assert.equal(period.previousStart.toISOString(), "2026-08-21T00:00:00.000Z");
});

test("admin analytics builds complete daily delivery and session series", () => {
  const series = buildAdminDailySeries({
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    days: 3,
    aggregateRows: [
      { bucketStart: new Date("2026-09-01T10:00:00.000Z"), _sum: { playbackCompletedCount: 8, playbackFailedCount: 1, playbackInterruptedCount: 1, heartbeatCount: 12 } },
      { bucketStart: new Date("2026-09-01T11:00:00.000Z"), _sum: { playbackCompletedCount: 2, playbackFailedCount: 0, playbackInterruptedCount: 0, heartbeatCount: 4 } }
    ],
    leaseRows: [{ createdAt: new Date("2026-09-01T12:00:00.000Z") }, { createdAt: new Date("2026-09-03T08:00:00.000Z") }]
  });
  assert.deepEqual(series, [
    { key: "2026-09-01", completed: 10, failed: 2, heartbeats: 16, sessionStarts: 1 },
    { key: "2026-09-02", completed: 0, failed: 0, heartbeats: 0, sessionStarts: 0 },
    { key: "2026-09-03", completed: 0, failed: 0, heartbeats: 0, sessionStarts: 1 }
  ]);
  assert.deepEqual(sumAdminAnalyticsSeries(series), { completed: 10, failed: 2, heartbeats: 16, sessionStarts: 2 });
});

test("admin analytics comparisons and service families are stable", () => {
  assert.deepEqual(analyticsChange(120, 100), { percentage: 20, direction: "up" });
  assert.deepEqual(analyticsChange(75, 100), { percentage: -25, direction: "down" });
  assert.deepEqual(analyticsChange(5, 0), { percentage: null, direction: "new" });
  assert.equal(classifyServiceFamily({ plan: { name: "School Pro", code: "school-pro" } }), "School Radio");
  assert.equal(classifyServiceFamily({ plan: { name: "Online Network", code: "online-network" } }), "Complete Online Radio");
  assert.equal(classifyServiceFamily({ plan: { name: "Retail Business", code: "retail-business" } }), "Retail / In-house Radio");
});

test("management export is CSV-safe and contains operational sections", () => {
  const csv = adminManagementCsv({
    filters: { days: 14, from: "2026-08-21", to: "2026-09-03" },
    totals: { organisations: 3, activeSubscriptions: 2, activeStations: 4, configuredPlayers: 5, onlinePlayers: 4 },
    periodTotals: { completed: 90, failed: 2, sessionStarts: 8, heartbeats: 500 },
    attention: { offlinePlayers: 1, openSupportTickets: 2, playerIncidents: 1, streamIncidents: 0, deadLetterJobs: 0 },
    serviceMix: [{ label: "Retail / In-house Radio", value: 2 }],
    topOrganisations: [{ name: "Retail, Malta", completed: 80, failed: 1 }],
    topStations: [{ name: "Main Radio", completed: 75, organisationName: "Retail, Malta" }]
  });
  assert.match(csv, /Reporting period,From,2026-08-21,14 days/);
  assert.match(csv, /Attention,Offline players,1/);
  assert.match(csv, /Organisation delivery,"Retail, Malta",80/);
});
