import { randomUUID } from "node:crypto";
import {
  JOB_BATCH_SIZE,
  JOB_LEASE_SECONDS,
  JOB_MAX_ATTEMPTS,
  jobRetryDelayMs,
  normalizeNotificationEvent,
  safeJobError,
  structuredWorkerLog
} from "./job-notification.mjs";

const CLAIMABLE_STATUSES = ["QUEUED", "RETRY_SCHEDULED", "LEASED"];

export async function enqueueNotificationEvent(tx, input) {
  const normalized = normalizeNotificationEvent(input);
  const event = normalized.dedupeKey
    ? await tx.notificationEvent.upsert({
      where: { organisationId_dedupeKey: { organisationId: normalized.organisationId, dedupeKey: normalized.dedupeKey } },
      create: normalized,
      update: {}
    })
    : await tx.notificationEvent.create({ data: normalized });
  if (event.deliveryJobId) return event;

  const idempotencyKey = `notification:${event.id}`;
  const job = await tx.job.upsert({
    where: { organisationId_type_idempotencyKey: { organisationId: event.organisationId, type: "NOTIFICATION_DELIVERY", idempotencyKey } },
    create: {
      organisationId: event.organisationId,
      type: "NOTIFICATION_DELIVERY",
      payload: { notificationEventId: event.id },
      idempotencyKey,
      correlationId: event.correlationId,
      requestId: input.requestId || null,
      maxAttempts: JOB_MAX_ATTEMPTS
    },
    update: {}
  });
  return tx.notificationEvent.update({
    where: { id: event.id },
    data: { deliveryJobId: job.id, deliveryQueuedAt: new Date() }
  });
}

export async function claimJobs(prismaClient, {
  workerId,
  now = new Date(),
  limit = JOB_BATCH_SIZE,
  leaseSeconds = JOB_LEASE_SECONDS,
  organisationId = null
} = {}) {
  const owner = String(workerId || "operations-worker").slice(0, 120);
  const take = Math.max(1, Math.min(100, Number(limit) || JOB_BATCH_SIZE));
  const leaseUntil = new Date(now.getTime() + Math.max(10, leaseSeconds) * 1_000);
  const candidates = await prismaClient.job.findMany({
    where: {
      ...(organisationId ? { organisationId } : {}),
      availableAt: { lte: now },
      OR: [
        { status: { in: ["QUEUED", "RETRY_SCHEDULED"] }, leaseUntil: null },
        { status: "LEASED", leaseUntil: { lte: now } }
      ]
    },
    orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
    take
  });

  const claimed = [];
  for (const candidate of candidates) {
    const leaseToken = randomUUID();
    const result = await prismaClient.job.updateMany({
      where: {
        id: candidate.id,
        status: { in: CLAIMABLE_STATUSES },
        availableAt: { lte: now },
        OR: [
          { leaseUntil: null },
          { leaseUntil: { lte: now } }
        ]
      },
      data: {
        status: "LEASED",
        leaseToken,
        leaseOwner: owner,
        leaseUntil,
        startedAt: candidate.startedAt || now,
        attempts: { increment: 1 }
      }
    });
    if (result.count === 1) claimed.push(await prismaClient.job.findUniqueOrThrow({ where: { id: candidate.id } }));
  }
  return claimed;
}

export async function completeJob(prismaClient, job, result = null, now = new Date()) {
  const updated = await prismaClient.job.updateMany({
    where: { id: job.id, status: "LEASED", leaseToken: job.leaseToken },
    data: {
      status: "SUCCEEDED",
      result,
      completedAt: now,
      leaseToken: null,
      leaseOwner: null,
      leaseUntil: null,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  });
  if (updated.count !== 1) throw new Error("The job lease is no longer valid.");
}

export async function failJob(prismaClient, job, error, now = new Date()) {
  const safe = safeJobError(error);
  const deadLetter = job.attempts >= job.maxAttempts;
  const availableAt = new Date(now.getTime() + jobRetryDelayMs(job.attempts));
  const updated = await prismaClient.job.updateMany({
    where: { id: job.id, status: "LEASED", leaseToken: job.leaseToken },
    data: {
      status: deadLetter ? "DEAD_LETTER" : "RETRY_SCHEDULED",
      availableAt: deadLetter ? job.availableAt : availableAt,
      deadLetteredAt: deadLetter ? now : null,
      leaseToken: null,
      leaseOwner: null,
      leaseUntil: null,
      lastErrorCode: safe.code,
      lastErrorMessage: safe.message
    }
  });
  if (updated.count !== 1) throw new Error("The job lease is no longer valid.");
  return { deadLetter, ...safe, availableAt: deadLetter ? null : availableAt };
}

export async function deliverNotificationEvent(prismaClient, job, now = new Date()) {
  const eventId = typeof job.payload === "object" && job.payload ? job.payload.notificationEventId : null;
  if (!eventId) throw Object.assign(new Error("Notification event id is missing."), { code: "INVALID_JOB_PAYLOAD" });
  const event = await prismaClient.notificationEvent.findUnique({ where: { id: eventId } });
  if (!event) throw Object.assign(new Error("Notification event was not found."), { code: "NOTIFICATION_EVENT_NOT_FOUND" });
  if (event.dispatchedAt) return { eventId: event.id, alreadyDispatched: true };

  const memberships = await prismaClient.organisationMember.findMany({
    where: { organisationId: event.organisationId, role: { not: "STUDENT" } },
    select: { userId: true }
  });
  const userIds = [...new Set(memberships.map((membership) => membership.userId))];
  const preferences = userIds.length ? await prismaClient.notificationPreference.findMany({
    where: {
      organisationId: event.organisationId,
      userId: { in: userIds },
      type: event.type,
      channel: "IN_APP"
    },
    select: { userId: true, enabled: true }
  }) : [];
  const enabledByUser = new Map(preferences.map((preference) => [preference.userId, preference.enabled]));

  if (userIds.length) {
    await prismaClient.notificationDelivery.createMany({
      data: userIds.map((userId) => {
        const enabled = enabledByUser.get(userId) !== false;
        return {
          organisationId: event.organisationId,
          notificationEventId: event.id,
          userId,
          channel: "IN_APP",
          status: enabled ? "DELIVERED" : "SKIPPED",
          deliveredAt: enabled ? now : null
        };
      }),
      skipDuplicates: true
    });
  }
  await prismaClient.notificationEvent.update({ where: { id: event.id }, data: { dispatchedAt: now } });
  return {
    eventId: event.id,
    recipients: userIds.length,
    delivered: userIds.filter((userId) => enabledByUser.get(userId) !== false).length,
    skipped: userIds.filter((userId) => enabledByUser.get(userId) === false).length
  };
}

export async function processJobBatch(prismaClient, {
  workerId,
  now = new Date(),
  limit = JOB_BATCH_SIZE,
  organisationId = null,
  log = (entry) => console.log(JSON.stringify(entry))
} = {}) {
  const jobs = await claimJobs(prismaClient, { workerId, now, limit, organisationId });
  let succeeded = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const job of jobs) {
    log(structuredWorkerLog("info", "job_started", job));
    try {
      if (job.type !== "NOTIFICATION_DELIVERY") throw Object.assign(new Error("Unsupported job type."), { code: "UNSUPPORTED_JOB_TYPE" });
      const result = await deliverNotificationEvent(prismaClient, job, now);
      await completeJob(prismaClient, job, result, now);
      succeeded += 1;
      log(structuredWorkerLog("info", "job_succeeded", job, result));
    } catch (error) {
      const failure = await failJob(prismaClient, job, error, now);
      if (failure.deadLetter) deadLettered += 1;
      else retried += 1;
      log(structuredWorkerLog(failure.deadLetter ? "error" : "warn", failure.deadLetter ? "job_dead_lettered" : "job_retry_scheduled", job, {
        errorCode: failure.code,
        nextAttemptAt: failure.availableAt?.toISOString() || null
      }));
    }
  }
  return { claimed: jobs.length, succeeded, retried, deadLettered };
}

export async function retryDeadLetterJob(prismaClient, jobId, { now = new Date() } = {}) {
  const updated = await prismaClient.job.updateMany({
    where: { id: jobId, status: "DEAD_LETTER" },
    data: {
      status: "QUEUED",
      attempts: 0,
      availableAt: now,
      deadLetteredAt: null,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  });
  return updated.count === 1;
}

export async function getJobOperations(prismaClient) {
  const [jobs, grouped] = await Promise.all([
    prismaClient.job.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 150,
      select: {
        id: true,
        organisationId: true,
        type: true,
        status: true,
        priority: true,
        correlationId: true,
        requestId: true,
        attempts: true,
        maxAttempts: true,
        availableAt: true,
        leaseOwner: true,
        leaseUntil: true,
        startedAt: true,
        completedAt: true,
        deadLetteredAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        createdAt: true,
        organisation: { select: { id: true, name: true } }
      }
    }),
    prismaClient.job.groupBy({ by: ["status"], _count: { _all: true } })
  ]);
  return { generatedAt: new Date(), summary: Object.fromEntries(grouped.map((item) => [item.status, item._count._all])), jobs };
}

export async function getInAppNotifications(prismaClient, { organisationId, userId, take = 100 }) {
  const deliveries = await prismaClient.notificationDelivery.findMany({
    where: { organisationId, userId, channel: "IN_APP", status: "DELIVERED", dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(200, Number(take) || 100)),
    select: {
      id: true,
      status: true,
      deliveredAt: true,
      readAt: true,
      createdAt: true,
      notificationEvent: {
        select: { id: true, type: true, severity: true, title: true, message: true, entityType: true, entityId: true, occurredAt: true }
      }
    }
  });
  return { unread: deliveries.filter((delivery) => !delivery.readAt).length, deliveries };
}

export async function updateInAppDelivery(prismaClient, { deliveryId, organisationId, userId, action, now = new Date() }) {
  const data = action === "DISMISS" ? { dismissedAt: now, readAt: now } : { readAt: now };
  const updated = await prismaClient.notificationDelivery.updateMany({
    where: { id: deliveryId, organisationId, userId, channel: "IN_APP", status: "DELIVERED" },
    data
  });
  return updated.count === 1;
}

export async function setInAppPreference(prismaClient, { organisationId, userId, type, enabled }) {
  return prismaClient.notificationPreference.upsert({
    where: { organisationId_userId_type_channel: { organisationId, userId, type, channel: "IN_APP" } },
    create: { organisationId, userId, type, channel: "IN_APP", enabled },
    update: { enabled }
  });
}
