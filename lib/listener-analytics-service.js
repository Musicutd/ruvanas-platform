import {
  aggregateListenerAnalyticsEvents,
  buildListenerAnalyticsReport,
  LISTENER_ANALYTICS_AGGREGATE_RETENTION_DAYS,
  LISTENER_ANALYTICS_RAW_RETENTION_DAYS,
  listenerAnalyticsHourBucket,
  normalizeListenerAnalyticsBatch,
  normalizeListenerAnalyticsFilters,
  verifyListenerTelemetryToken
} from "./listener-analytics.mjs";

function nextHour(bucketStart) {
  return new Date(new Date(bucketStart).getTime() + 60 * 60 * 1000);
}

export async function ingestListenerAnalytics(database, { token, body, instant = new Date(), secret }) {
  const authority = verifyListenerTelemetryToken(token, { instant, secret });
  if (!authority) return { ok: false, status: 401, error: "The listener analytics session is invalid or has expired." };
  const events = normalizeListenerAnalyticsBatch(body, { instant });
  const channel = await database.channel.findFirst({
    where: { id: authority.channelId, organisationId: authority.organisationId, status: "ACTIVE" },
    select: { id: true }
  });
  if (!channel) return { ok: false, status: 404, error: "The active radio channel is unavailable." };
  const result = await database.listenerAnalyticsEvent.createMany({
    data: events.map((event) => ({
      ...event,
      organisationId: authority.organisationId,
      channelId: authority.channelId,
      sessionHash: authority.sessionHash
    })),
    skipDuplicates: true
  });
  return { ok: true, accepted: result.count, received: events.length };
}

async function aggregateOneBatch(database, organisationId, batchSize) {
  const cursor = await database.listenerAnalyticsAggregationCursor.findUnique({ where: { organisationId } });
  const after = cursor?.lastEventReceivedAt ? {
    OR: [
      { receivedAt: { gt: cursor.lastEventReceivedAt } },
      { receivedAt: cursor.lastEventReceivedAt, id: { gt: cursor.lastEventId || "" } }
    ]
  } : {};
  const events = await database.listenerAnalyticsEvent.findMany({
    where: { organisationId, ...after },
    select: { id: true, channelId: true, sessionHash: true, eventType: true, occurredAt: true, receivedAt: true, listeningSeconds: true, channel: { select: { name: true } } },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: batchSize
  });
  if (!events.length) return { processed: 0, more: false };

  const buckets = new Map();
  for (const event of events) {
    const bucketStart = listenerAnalyticsHourBucket(event.occurredAt);
    buckets.set(`${event.channelId}:${bucketStart.toISOString()}`, { channelId: event.channelId, channelName: event.channel.name, bucketStart });
  }

  for (const bucket of buckets.values()) {
    const bucketEvents = await database.listenerAnalyticsEvent.findMany({
      where: { organisationId, channelId: bucket.channelId, occurredAt: { gte: bucket.bucketStart, lt: nextHour(bucket.bucketStart) } },
      select: { sessionHash: true, eventType: true, listeningSeconds: true, receivedAt: true }
    });
    const aggregate = aggregateListenerAnalyticsEvents(bucketEvents, { organisationId, ...bucket });
    const { organisationId: scopedOrganisationId, channelId, bucketStart, ...data } = aggregate;
    await database.listenerAnalyticsHourlyAggregate.upsert({
      where: { organisationId_channelId_bucketStart: { organisationId: scopedOrganisationId, channelId, bucketStart } },
      create: { organisationId: scopedOrganisationId, channelId, bucketStart, ...data },
      update: data
    });
  }

  const last = events.at(-1);
  await database.listenerAnalyticsAggregationCursor.upsert({
    where: { organisationId },
    create: { organisationId, lastEventReceivedAt: last.receivedAt, lastEventId: last.id },
    update: { lastEventReceivedAt: last.receivedAt, lastEventId: last.id }
  });
  return { processed: events.length, more: events.length === batchSize };
}

export async function refreshListenerAnalytics(database, organisationId, { batchSize = 1_000, maxBatches = 3 } = {}) {
  let processed = 0;
  let more = true;
  for (let batch = 0; batch < maxBatches && more; batch += 1) {
    const result = await aggregateOneBatch(database, organisationId, batchSize);
    processed += result.processed;
    more = result.more;
  }
  return { processed, more };
}

export async function refreshPendingListenerAnalytics(database, { organisationLimit = 100 } = {}) {
  const organisations = await database.organisation.findMany({
    where: { listenerAnalyticsEvents: { some: {} } },
    select: { id: true },
    take: organisationLimit,
    orderBy: { id: "asc" }
  });
  let processed = 0;
  for (const organisation of organisations) processed += (await refreshListenerAnalytics(database, organisation.id)).processed;
  return { organisations: organisations.length, processed };
}

export async function applyListenerAnalyticsRetention(database, instant = new Date()) {
  const rawBefore = new Date(instant.getTime() - LISTENER_ANALYTICS_RAW_RETENTION_DAYS * 86_400_000);
  const aggregateBefore = new Date(instant.getTime() - LISTENER_ANALYTICS_AGGREGATE_RETENTION_DAYS * 86_400_000);
  const [raw, aggregate] = await Promise.all([
    database.listenerAnalyticsEvent.deleteMany({ where: { receivedAt: { lt: rawBefore } } }),
    database.listenerAnalyticsHourlyAggregate.deleteMany({ where: { bucketStart: { lt: aggregateBefore } } })
  ]);
  return { rawDeleted: raw.count, aggregatesDeleted: aggregate.count };
}

export async function loadListenerAnalyticsReport(database, organisationId, input = {}, instant = new Date()) {
  const filters = normalizeListenerAnalyticsFilters(input, instant);
  const from = new Date(`${filters.from}T00:00:00.000Z`);
  const until = new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86_400_000);
  const rows = await database.listenerAnalyticsHourlyAggregate.findMany({
    where: { organisationId, bucketStart: { gte: from, lt: until } },
    orderBy: [{ bucketStart: "asc" }, { channelName: "asc" }]
  });
  return buildListenerAnalyticsReport(rows, filters);
}
