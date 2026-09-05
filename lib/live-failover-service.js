import { prisma } from "./prisma.js";
import { enqueueNotificationEvent } from "./job-notification-service.js";
import { probeExternalLiveSource } from "./external-live-service.js";
import { decideLiveFailover, failoverSourceAvailability, safeLiveFailoverPolicy } from "./live-failover.mjs";

const policyInclude = {
  channel: { select: { id: true, name: true, status: true, station: { select: { name: true } } } },
  primarySource: true,
  backupSource: true,
  effectiveSource: true,
  manualSource: true,
  events: { orderBy: { observedAt: "desc" }, take: 12 }
};

const evidenceFor = (policy, decision) => ({
  previousState: policy.state,
  nextState: decision.state,
  primaryHealth: policy.primarySource.healthStatus || "UNKNOWN",
  primaryConsecutiveFailures: policy.primarySource.consecutiveFailures || 0,
  backupHealth: policy.backupSource?.healthStatus || null,
  failureThreshold: policy.failureThreshold,
  recoveryThreshold: policy.recoveryThreshold,
  recoveryHoldSeconds: policy.recoveryHoldSeconds,
  transitionVersion: (policy.transitionVersion || 0) + 1
});

async function recordTransition(tx, policy, decision, { now, actorUserId = null } = {}) {
  const event = await tx.liveFailoverEvent.create({ data: {
    policyId: policy.id,
    organisationId: policy.organisationId,
    channelId: policy.channelId,
    kind: decision.kind,
    fromSourceId: policy.effectiveSourceId,
    toSourceId: decision.effectiveSourceId,
    reason: decision.lastTransitionReason,
    evidence: evidenceFor(policy, decision),
    actorUserId,
    observedAt: now
  } });
  if (["BACKUP_SELECTED", "PROGRAMMING_FALLBACK_SELECTED"].includes(decision.kind)) {
    await enqueueNotificationEvent(tx, {
      organisationId: policy.organisationId,
      type: "STREAM_ERROR",
      severity: decision.effectiveSourceId ? "WARNING" : "CRITICAL",
      title: decision.effectiveSourceId ? "External Live moved to backup" : "External Live moved to scheduled programming",
      message: decision.effectiveSourceId
        ? `${policy.channel.name} moved to its protected backup live source after primary health checks failed.`
        : `${policy.channel.name} has no healthy live source. The unified playout engine is using scheduled programming or AutoDJ.`,
      entityType: "LiveFailoverPolicy",
      entityId: policy.id,
      metadata: { channelId: policy.channelId, state: decision.state, eventId: event.id },
      dedupeKey: `live-failover:${event.id}`,
      correlationId: `live-failover:${policy.id}`,
      occurredAt: now
    });
  }
  if (decision.kind === "PRIMARY_RECOVERED") {
    await enqueueNotificationEvent(tx, {
      organisationId: policy.organisationId,
      type: "STREAM_ERROR",
      severity: "INFO",
      title: "External Live primary recovered",
      message: `${policy.channel.name} returned to its primary live source after the configured recovery hold and healthy probes completed.`,
      entityType: "LiveFailoverPolicy",
      entityId: policy.id,
      metadata: { channelId: policy.channelId, state: decision.state, eventId: event.id },
      dedupeKey: `live-failover:${event.id}`,
      correlationId: `live-failover:${policy.id}`,
      occurredAt: now
    });
  }
  return event;
}

export async function listLiveFailoverPolicies(organisationId) {
  const policies = await prisma.liveFailoverPolicy.findMany({
    where: { organisationId },
    include: policyInclude,
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  return policies.map(safeLiveFailoverPolicy);
}

export async function saveLiveFailoverPolicy({ organisationId, actorUserId, input, now = new Date() }) {
  const sources = await prisma.externalLiveSource.findMany({
    where: { organisationId, channelId: input.channelId, id: { in: [input.primarySourceId, input.backupSourceId].filter(Boolean) }, status: { in: ["READY", "ACTIVE"] } }
  });
  const primary = sources.find((source) => source.id === input.primarySourceId);
  const backup = input.backupSourceId ? sources.find((source) => source.id === input.backupSourceId) : null;
  if (!primary || (input.backupSourceId && !backup)) throw new Error("Choose ready live sources owned by this channel.");
  if (input.enabled && !failoverSourceAvailability(primary, now).available) throw new Error("Test the primary source successfully before enabling failover.");
  if (input.enabled && backup && !failoverSourceAvailability(backup, now).available) throw new Error("Test the backup source successfully before enabling failover.");

  return prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findFirst({ where: { id: input.channelId, organisationId, status: "ACTIVE" }, select: { id: true, name: true } });
    if (!channel) throw new Error("Choose an active channel owned by this organisation.");
    const existing = await tx.liveFailoverPolicy.findUnique({ where: { organisationId_channelId: { organisationId, channelId: channel.id } } });
    if (input.enabled) {
      await tx.externalLiveSource.updateMany({ where: { organisationId, channelId: channel.id, status: "ACTIVE", id: { not: primary.id } }, data: { status: "READY", suspendedAt: now } });
      await tx.externalLiveSource.update({ where: { id: primary.id }, data: { status: "ACTIVE", suspendedAt: null } });
    }
    const policy = await tx.liveFailoverPolicy.upsert({
      where: { organisationId_channelId: { organisationId, channelId: channel.id } },
      create: {
        organisationId, channelId: channel.id, primarySourceId: primary.id, backupSourceId: backup?.id || null,
        effectiveSourceId: input.enabled ? primary.id : null, enabled: input.enabled,
        state: input.enabled ? "PRIMARY" : "SCHEDULED_FALLBACK", failureThreshold: input.failureThreshold,
        recoveryThreshold: input.recoveryThreshold, recoveryHoldSeconds: input.recoveryHoldSeconds,
        lastTransitionAt: now, lastTransitionReason: input.enabled ? "POLICY_ENABLED_BY_MANAGER" : "POLICY_SAVED_DISABLED",
        transitionVersion: 1, createdByUserId: actorUserId, updatedByUserId: actorUserId
      },
      update: {
        primarySourceId: primary.id, backupSourceId: backup?.id || null, effectiveSourceId: input.enabled ? primary.id : null,
        manualSourceId: null, manualOverrideUntil: null, enabled: input.enabled,
        state: input.enabled ? "PRIMARY" : "SCHEDULED_FALLBACK", failureThreshold: input.failureThreshold,
        recoveryThreshold: input.recoveryThreshold, recoveryHoldSeconds: input.recoveryHoldSeconds,
        recoveryHealthyProbes: 0, primaryHealthySince: null, lastTransitionAt: now,
        lastTransitionReason: input.enabled ? "POLICY_ENABLED_BY_MANAGER" : "POLICY_SAVED_DISABLED",
        transitionVersion: { increment: 1 }, updatedByUserId: actorUserId
      },
      include: policyInclude
    });
    await tx.liveFailoverEvent.create({ data: {
      policyId: policy.id, organisationId, channelId: channel.id,
      kind: input.enabled ? "POLICY_ENABLED" : "POLICY_DISABLED", fromSourceId: existing?.effectiveSourceId || null,
      toSourceId: input.enabled ? primary.id : null, reason: input.enabled ? "POLICY_ENABLED_BY_MANAGER" : "POLICY_SAVED_DISABLED",
      evidence: { failureThreshold: input.failureThreshold, recoveryThreshold: input.recoveryThreshold, recoveryHoldSeconds: input.recoveryHoldSeconds },
      actorUserId, observedAt: now
    } });
    await tx.auditLog.create({ data: {
      organisationId, actorUserId, action: "LIVE_FAILOVER_POLICY_SAVED", entityType: "LiveFailoverPolicy", entityId: policy.id,
      details: { channelId: channel.id, enabled: input.enabled, hasBackup: Boolean(backup), failureThreshold: input.failureThreshold, recoveryThreshold: input.recoveryThreshold, recoveryHoldSeconds: input.recoveryHoldSeconds }
    } });
    return safeLiveFailoverPolicy(policy);
  });
}

export async function reconcileLiveFailoverPolicy(database, policyId, { now = new Date(), actorUserId = null } = {}) {
  const policy = await database.liveFailoverPolicy.findUnique({ where: { id: policyId }, include: policyInclude });
  if (!policy || !policy.enabled) return null;
  const decision = decideLiveFailover(policy, { primary: policy.primarySource, backup: policy.backupSource, manual: policy.manualSource }, now);
  return database.$transaction(async (tx) => {
    const updated = await tx.liveFailoverPolicy.update({ where: { id: policy.id }, data: {
      state: decision.state, effectiveSourceId: decision.effectiveSourceId, manualSourceId: decision.manualSourceId,
      manualOverrideUntil: decision.manualOverrideUntil, primaryHealthySince: decision.primaryHealthySince,
      recoveryHealthyProbes: decision.recoveryHealthyProbes,
      ...(decision.changed ? { lastTransitionAt: now, lastTransitionReason: decision.lastTransitionReason, transitionVersion: { increment: 1 } } : {})
    }, include: policyInclude });
    if (decision.kind) await recordTransition(tx, policy, decision, { now, actorUserId });
    return { policy: safeLiveFailoverPolicy(updated), decision };
  });
}

export async function changeLiveFailoverPolicy({ organisationId, actorUserId, input, now = new Date() }) {
  const policy = await prisma.liveFailoverPolicy.findFirst({ where: { id: input.policyId, organisationId }, include: policyInclude });
  if (!policy) return null;
  if (input.action === "DISABLE") {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.liveFailoverPolicy.update({ where: { id: policy.id }, data: { enabled: false, state: "SCHEDULED_FALLBACK", effectiveSourceId: null, manualSourceId: null, manualOverrideUntil: null, recoveryHealthyProbes: 0, primaryHealthySince: null, lastTransitionAt: now, lastTransitionReason: "POLICY_DISABLED_BY_MANAGER", transitionVersion: { increment: 1 }, updatedByUserId: actorUserId }, include: policyInclude });
      await tx.liveFailoverEvent.create({ data: { policyId: policy.id, organisationId, channelId: policy.channelId, kind: "POLICY_DISABLED", fromSourceId: policy.effectiveSourceId, reason: "POLICY_DISABLED_BY_MANAGER", actorUserId, observedAt: now } });
      await tx.auditLog.create({ data: { organisationId, actorUserId, action: "LIVE_FAILOVER_POLICY_DISABLED", entityType: "LiveFailoverPolicy", entityId: policy.id, details: { channelId: policy.channelId } } });
      return safeLiveFailoverPolicy(updated);
    });
  }
  if (input.action === "OVERRIDE") {
    const source = await prisma.externalLiveSource.findFirst({ where: { id: input.sourceId, organisationId, channelId: policy.channelId, status: { in: ["READY", "ACTIVE"] } } });
    if (!source || !failoverSourceAvailability(source, now).available) throw new Error("A manual override requires a recently tested, healthy source on this channel.");
    const until = new Date(now.getTime() + input.durationMinutes * 60_000);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.liveFailoverPolicy.update({ where: { id: policy.id }, data: { enabled: true, state: "MANUAL_OVERRIDE", effectiveSourceId: source.id, manualSourceId: source.id, manualOverrideUntil: until, recoveryHealthyProbes: 0, primaryHealthySince: null, lastTransitionAt: now, lastTransitionReason: "MANUAL_OVERRIDE_BY_MANAGER", transitionVersion: { increment: 1 }, updatedByUserId: actorUserId }, include: policyInclude });
      await tx.liveFailoverEvent.create({ data: { policyId: policy.id, organisationId, channelId: policy.channelId, kind: "MANUAL_SOURCE_SELECTED", fromSourceId: policy.effectiveSourceId, toSourceId: source.id, reason: "MANUAL_OVERRIDE_BY_MANAGER", evidence: { durationMinutes: input.durationMinutes }, actorUserId, observedAt: now } });
      await tx.auditLog.create({ data: { organisationId, actorUserId, action: "LIVE_FAILOVER_MANUAL_OVERRIDE", entityType: "LiveFailoverPolicy", entityId: policy.id, details: { channelId: policy.channelId, sourceId: source.id, durationMinutes: input.durationMinutes } } });
      return safeLiveFailoverPolicy(updated);
    });
  }
  await prisma.liveFailoverPolicy.update({ where: { id: policy.id }, data: { manualSourceId: null, manualOverrideUntil: null, updatedByUserId: actorUserId } });
  await prisma.auditLog.create({ data: { organisationId, actorUserId, action: "LIVE_FAILOVER_MANUAL_OVERRIDE_CLEARED", entityType: "LiveFailoverPolicy", entityId: policy.id, details: { channelId: policy.channelId } } });
  return (await reconcileLiveFailoverPolicy(prisma, policy.id, { now, actorUserId }))?.policy || null;
}

export async function scanLiveFailoverPolicies(database, { now = new Date(), fetchImpl, lookupImpl } = {}) {
  const dueBefore = new Date(now.getTime() - 30_000);
  const policies = await database.liveFailoverPolicy.findMany({ where: { enabled: true }, include: policyInclude, orderBy: { updatedAt: "asc" }, take: 50 });
  const results = [];
  for (const policy of policies) {
    const sources = [policy.primarySource, policy.backupSource, policy.manualSource].filter((source, index, all) => source && all.findIndex((candidate) => candidate?.id === source.id) === index);
    for (const source of sources) {
      if (!source.lastHealthCheckedAt || new Date(source.lastHealthCheckedAt) <= dueBefore) {
        await probeExternalLiveSource(database, source, { now, fetchImpl, lookupImpl });
      }
    }
    const reconciled = await reconcileLiveFailoverPolicy(database, policy.id, { now });
    if (reconciled) results.push(reconciled);
  }
  return {
    scanned: results.length,
    transitioned: results.filter((item) => item.decision.changed).length,
    onPrimary: results.filter((item) => item.decision.state === "PRIMARY").length,
    onBackup: results.filter((item) => item.decision.state === "BACKUP").length,
    onScheduledFallback: results.filter((item) => item.decision.state === "SCHEDULED_FALLBACK").length
  };
}

export { policyInclude as liveFailoverPolicyInclude };
