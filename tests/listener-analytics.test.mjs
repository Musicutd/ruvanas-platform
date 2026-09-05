import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateListenerAnalyticsEvents,
  buildListenerAnalyticsReport,
  createListenerTelemetryToken,
  listenerAnalyticsCsv,
  listenerSessionHash,
  normalizeListenerAnalyticsBatch,
  normalizeListenerAnalyticsFilters,
  verifyListenerTelemetryToken
} from "../lib/listener-analytics.mjs";
import { ingestListenerAnalytics } from "../lib/listener-analytics-service.js";

const secret = "stage-19-13-listener-analytics-test-secret";
const instant = new Date("2026-09-05T12:00:00.000Z");
const sessionId = "11111111-1111-4111-8111-111111111111";

function telemetryToken(overrides = {}) {
  return createListenerTelemetryToken({
    organisationId: "org-a",
    channelId: "channel-a",
    sessionId,
    issuedAt: instant,
    expiresAt: new Date(instant.getTime() + 10 * 60 * 1000),
    ...overrides
  }, secret);
}

test("listener telemetry tokens are anonymous, scoped, expiring and tamper evident", () => {
  const token = telemetryToken();
  const verified = verifyListenerTelemetryToken(token, { instant, secret });
  assert.equal(verified.organisationId, "org-a");
  assert.equal(verified.channelId, "channel-a");
  assert.equal(verified.sessionHash, listenerSessionHash(sessionId, secret));
  assert.doesNotMatch(token, new RegExp(sessionId));
  assert.equal(verifyListenerTelemetryToken(`${token}x`, { instant, secret }), null);
  assert.equal(verifyListenerTelemetryToken(token, { instant: new Date(instant.getTime() + 11 * 60 * 1000), secret }), null);
  assert.throws(() => telemetryToken({ expiresAt: new Date(instant.getTime() + 3 * 60 * 60 * 1000) }), /within two hours/);
});

test("listener event batches are bounded and reject stale or inflated contributions", () => {
  const event = { eventId: "22222222-2222-4222-8222-222222222222", type: "HEARTBEAT", occurredAt: instant.toISOString(), listeningSeconds: 30 };
  assert.deepEqual(normalizeListenerAnalyticsBatch({ events: [event] }, { instant })[0], {
    clientEventId: event.eventId,
    eventType: "HEARTBEAT",
    occurredAt: instant,
    listeningSeconds: 30
  });
  assert.throws(() => normalizeListenerAnalyticsBatch({ events: Array(21).fill(event) }, { instant }), /between 1 and 20/);
  assert.throws(() => normalizeListenerAnalyticsBatch({ events: [{ ...event, listeningSeconds: 61 }] }, { instant }), /0 to 60/);
  assert.throws(() => normalizeListenerAnalyticsBatch({ events: [{ ...event, occurredAt: "2026-09-05T11:40:00.000Z" }] }, { instant }), /close/);
});

test("duplicate-safe ingestion stores only token-owned channel data", async () => {
  const stored = new Map();
  const database = {
    channel: { async findFirst({ where }) { return where.id === "channel-a" && where.organisationId === "org-a" && where.status === "ACTIVE" ? { id: where.id } : null; } },
    listenerAnalyticsEvent: {
      async createMany({ data }) {
        let count = 0;
        for (const row of data) {
          const key = `${row.channelId}:${row.clientEventId}`;
          if (!stored.has(key)) { stored.set(key, row); count += 1; }
        }
        return { count };
      }
    }
  };
  const body = { events: [{ eventId: "33333333-3333-4333-8333-333333333333", type: "SESSION_STARTED", occurredAt: instant.toISOString(), listeningSeconds: 0 }] };
  const first = await ingestListenerAnalytics(database, { token: telemetryToken(), body, instant, secret });
  const retry = await ingestListenerAnalytics(database, { token: telemetryToken(), body, instant, secret });
  assert.deepEqual({ accepted: first.accepted, received: first.received }, { accepted: 1, received: 1 });
  assert.equal(retry.accepted, 0);
  assert.equal(stored.values().next().value.organisationId, "org-a");
  assert.equal(stored.values().next().value.sessionHash.length, 64);

  const unavailable = await ingestListenerAnalytics(database, { token: telemetryToken({ channelId: "channel-b" }), body, instant, secret });
  assert.equal(unavailable.status, 404);
});

test("hourly aggregation counts anonymous sessions once and sums idempotent event contributions", () => {
  const events = [
    { sessionHash: "a".repeat(64), eventType: "SESSION_STARTED", listeningSeconds: 0, occurredAt: "2026-09-05T10:01:00Z", receivedAt: "2026-09-05T10:01:01Z" },
    { sessionHash: "a".repeat(64), eventType: "HEARTBEAT", listeningSeconds: 30, occurredAt: "2026-09-05T10:01:30Z", receivedAt: "2026-09-05T10:01:31Z" },
    { sessionHash: "a".repeat(64), eventType: "SESSION_ENDED", listeningSeconds: 12, occurredAt: "2026-09-05T10:01:42Z", receivedAt: "2026-09-05T10:01:43Z" },
    { sessionHash: "b".repeat(64), eventType: "PLAYBACK_ERROR", listeningSeconds: 0, occurredAt: "2026-09-05T10:02:00Z", receivedAt: "2026-09-05T10:02:01Z" }
  ];
  const row = aggregateListenerAnalyticsEvents(events, { organisationId: "org-a", channelId: "channel-a", channelName: "Main", bucketStart: events[0].occurredAt });
  assert.equal(row.bucketStart.toISOString(), "2026-09-05T10:00:00.000Z");
  assert.equal(row.sessionCount, 2);
  assert.equal(row.sessionStartedCount, 1);
  assert.equal(row.sessionEndedCount, 1);
  assert.equal(row.heartbeatCount, 1);
  assert.equal(row.playbackErrorCount, 1);
  assert.equal(row.listeningSeconds, 42);
});

test("listener reports are bounded, explicit about measurement limits and safe to export", () => {
  const filters = normalizeListenerAnalyticsFilters({ from: "2026-09-01", to: "2026-09-03" }, instant);
  const report = buildListenerAnalyticsReport([{
    channelId: "channel-a", channelName: "Ruvanas Live", bucketStart: new Date("2026-09-02T10:00:00Z"),
    sessionCount: 8, sessionStartedCount: 6, sessionEndedCount: 5, heartbeatCount: 30, playbackErrorCount: 1, listeningSeconds: 3600
  }], filters);
  assert.equal(report.days.length, 3);
  assert.equal(report.totals.sessionStarts, 6);
  assert.equal(report.totals.listenerHours, 1);
  assert.equal(report.totals.averageListeningMinutes, 10);
  assert.equal(report.totals.peakHourlyListeners, 8);
  assert.equal(report.privacy.storesPersonalIdentity, false);
  assert.equal(report.privacy.storesIpAddress, false);
  const csv = listenerAnalyticsCsv(report);
  assert.match(csv, /Anonymous sessions/);
  assert.match(csv, /Ruvanas Live/);
  assert.doesNotMatch(csv, /email address,[^\n]+@/i);
  assert.throws(() => normalizeListenerAnalyticsFilters({ from: "2026-01-01", to: "2026-09-01" }), /93 days/);
});

test("Stage 19.13 keeps ingestion, tenant reports, retention and navigation boundaries explicit", async () => {
  const [eventsRoute, reportRoute, exportRoute, service, worker, migration, navigation] = await Promise.all([
    readFile(new URL("../app/api/listener-analytics/events/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/listener-analytics/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/listener-analytics/export/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/listener-analytics-service.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/operations-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261014000000_stage_19_13_listener_analytics/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8")
  ]);
  assert.match(eventsRoute, /Bearer /);
  assert.match(eventsRoute, /32_768/);
  assert.doesNotMatch(eventsRoute, /getClientAddress|user-agent/i);
  assert.match(reportRoute, /requireListenerAnalyticsAccess/);
  assert.match(exportRoute, /exportReport: true/);
  assert.match(exportRoute, /LISTENER_ANALYTICS_EXPORTED/);
  assert.match(service, /skipDuplicates: true/);
  assert.match(service, /listenerAnalyticsAggregationCursor/);
  assert.match(worker, /refreshPendingListenerAnalytics/);
  assert.match(worker, /applyListenerAnalyticsRetention/);
  assert.match(migration, /ListenerAnalyticsEvent_channelId_clientEventId_key/);
  assert.match(migration, /FOREIGN KEY \("channelId", "organisationId"\)/);
  assert.match(navigation, /dashboard\/listener-analytics/);
});

test("a realistic listener-event hour collapses to one bounded row", () => {
  const events = [];
  for (let session = 0; session < 1_000; session += 1) {
    const sessionHash = session.toString(16).padStart(64, "0");
    events.push({ sessionHash, eventType: "SESSION_STARTED", listeningSeconds: 0, occurredAt: instant, receivedAt: instant });
    for (let heartbeat = 0; heartbeat < 10; heartbeat += 1) events.push({ sessionHash, eventType: "HEARTBEAT", listeningSeconds: 30, occurredAt: instant, receivedAt: instant });
  }
  const row = aggregateListenerAnalyticsEvents(events, { organisationId: "org-volume", channelId: "channel-volume", channelName: "Volume", bucketStart: instant });
  assert.equal(events.length, 11_000);
  assert.equal(row.sessionCount, 1_000);
  assert.equal(row.listeningSeconds, 300_000);
});
