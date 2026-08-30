import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  jobRetryDelayMs,
  normalizeNotificationEvent,
  safeJobError,
  structuredWorkerLog
} from "../lib/job-notification.mjs";
import {
  claimJobs,
  enqueueNotificationEvent,
  getInAppNotifications,
  processJobBatch,
  retryDeadLetterJob,
  setInAppPreference,
  updateInAppDelivery
} from "../lib/job-notification-service.js";

test("notification events retain only bounded operational fields", () => {
  const event = normalizeNotificationEvent({
    organisationId: "org-1",
    type: "player_offline",
    severity: "critical",
    title: " Player offline ",
    message: " Missed heartbeat\nfor the monitored device. ",
    metadata: { playerId: "player-1" },
    correlationId: "incident-1"
  });
  assert.equal(event.type, "PLAYER_OFFLINE");
  assert.equal(event.severity, "CRITICAL");
  assert.equal(event.message, "Missed heartbeat for the monitored device.");
  assert.deepEqual(event.metadata, { playerId: "player-1" });
  assert.throws(() => normalizeNotificationEvent({ ...event, type: "INVENTED" }), /Unsupported/);
  assert.throws(() => normalizeNotificationEvent({ ...event, message: "x".repeat(501) }), /between 1 and 500/);
});

test("job retries are bounded and worker errors remain safe", () => {
  assert.equal(jobRetryDelayMs(1), 5_000);
  assert.equal(jobRetryDelayMs(2), 10_000);
  assert.equal(jobRetryDelayMs(99), 15 * 60_000);
  assert.deepEqual(safeJobError(Object.assign(new Error("password=must-not-leak"), { code: "provider timeout" })), {
    code: "PROVIDER_TIMEOUT",
    message: "The background operation could not be completed."
  });
  const log = structuredWorkerLog("info", "job_started", { id: "job-1", type: "NOTIFICATION_DELIVERY", correlationId: "corr-1", requestId: "req-1", attempts: 1 });
  assert.equal(log.correlationId, "corr-1");
  assert.equal(log.requestId, "req-1");
  assert.equal(Object.hasOwn(log, "payload"), false);
});

test("database jobs lease once, deliver by preference, dead-letter, and recover", { skip: process.env.RUN_DATABASE_TESTS !== "1" }, async () => {
  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  const suffix = randomUUID();
  try {
    const user = await database.user.create({ data: { email: `job-${suffix}@example.test`, passwordHash: "test-only", name: "Job test owner" } });
    const organisation = await database.organisation.create({
      data: {
        name: `Job notifications ${suffix}`,
        slug: `job-notifications-${suffix}`,
        members: { create: { userId: user.id, role: "OWNER" } }
      }
    });

    await database.$transaction((tx) => enqueueNotificationEvent(tx, {
      organisationId: organisation.id,
      type: "PLAYER_OFFLINE",
      severity: "CRITICAL",
      title: "Player offline",
      message: "A monitored player missed its heartbeat window.",
      entityType: "Player",
      entityId: "player-test",
      dedupeKey: `player-offline:${suffix}`,
      correlationId: `incident:${suffix}`
    }));
    await database.$transaction((tx) => enqueueNotificationEvent(tx, {
      organisationId: organisation.id,
      type: "PLAYER_OFFLINE",
      severity: "CRITICAL",
      title: "Duplicate ignored",
      message: "This duplicate must not create another job.",
      dedupeKey: `player-offline:${suffix}`,
      correlationId: `incident:${suffix}`
    }));
    assert.equal(await database.notificationEvent.count({ where: { organisationId: organisation.id } }), 1);
    assert.equal(await database.job.count({ where: { organisationId: organisation.id } }), 1);

    const claimed = await claimJobs(database, { workerId: "test-worker", limit: 10, organisationId: organisation.id });
    assert.equal(claimed.length, 1);
    assert.equal((await claimJobs(database, { workerId: "second-worker", limit: 10, organisationId: organisation.id })).length, 0);
    const firstResult = await processJobBatch(database, { workerId: "test-worker-after-expiry", now: new Date(claimed[0].leaseUntil.getTime() + 1), organisationId: organisation.id, log: () => {} });
    assert.deepEqual(firstResult, { claimed: 1, succeeded: 1, retried: 0, deadLettered: 0 });
    const inbox = await getInAppNotifications(database, { organisationId: organisation.id, userId: user.id });
    assert.equal(inbox.unread, 1);
    assert.equal(inbox.deliveries[0].notificationEvent.type, "PLAYER_OFFLINE");
    assert.equal(await updateInAppDelivery(database, { deliveryId: inbox.deliveries[0].id, organisationId: organisation.id, userId: user.id, action: "READ" }), true);

    await setInAppPreference(database, { organisationId: organisation.id, userId: user.id, type: "STREAM_ERROR", enabled: false });
    await database.$transaction((tx) => enqueueNotificationEvent(tx, {
      organisationId: organisation.id,
      type: "STREAM_ERROR",
      severity: "WARNING",
      title: "Stream source degraded",
      message: "The source did not return expected audio content.",
      correlationId: `stream:${suffix}`
    }));
    assert.deepEqual(await processJobBatch(database, { workerId: "preference-worker", organisationId: organisation.id, log: () => {} }), { claimed: 1, succeeded: 1, retried: 0, deadLettered: 0 });
    assert.equal(await database.notificationDelivery.count({ where: { organisationId: organisation.id, status: "SKIPPED" } }), 1);

    const invalid = await database.job.create({
      data: {
        organisationId: organisation.id,
        type: "NOTIFICATION_DELIVERY",
        payload: {},
        correlationId: `invalid:${suffix}`,
        maxAttempts: 1
      }
    });
    assert.deepEqual(await processJobBatch(database, { workerId: "dead-letter-worker", organisationId: organisation.id, log: () => {} }), { claimed: 1, succeeded: 0, retried: 0, deadLettered: 1 });
    assert.equal((await database.job.findUniqueOrThrow({ where: { id: invalid.id } })).status, "DEAD_LETTER");
    assert.equal(await retryDeadLetterJob(database, invalid.id), true);
    assert.equal((await database.job.findUniqueOrThrow({ where: { id: invalid.id } })).status, "QUEUED");
  } finally {
    await database.organisation.deleteMany({ where: { slug: `job-notifications-${suffix}` } });
    await database.user.deleteMany({ where: { email: `job-${suffix}@example.test` } });
    await database.$disconnect();
  }
});
