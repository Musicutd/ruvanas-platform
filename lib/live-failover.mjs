import { EXTERNAL_LIVE_HEALTH_FRESH_SECONDS, externalLiveCandidate } from "./external-live.mjs";

const clampInteger = (value, minimum, maximum, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const text = (value, maximum = 160) => typeof value === "string" ? value.trim().slice(0, maximum) : "";

export function parseLiveFailoverPolicyInput(input = {}) {
  const channelId = text(input.channelId, 120);
  const primarySourceId = text(input.primarySourceId, 120);
  const backupSourceId = text(input.backupSourceId, 120) || null;
  if (!channelId) throw new Error("Choose an active channel.");
  if (!primarySourceId) throw new Error("Choose the primary live source.");
  if (backupSourceId === primarySourceId) throw new Error("Primary and backup must be different sources.");
  return {
    channelId,
    primarySourceId,
    backupSourceId,
    enabled: input.enabled !== false,
    failureThreshold: clampInteger(input.failureThreshold, 1, 5, 2),
    recoveryThreshold: clampInteger(input.recoveryThreshold, 1, 5, 3),
    recoveryHoldSeconds: clampInteger(input.recoveryHoldSeconds, 30, 600, 60)
  };
}

export function parseLiveFailoverAction(input = {}) {
  const action = text(input.action, 40).toUpperCase();
  if (!["DISABLE", "OVERRIDE", "CLEAR_OVERRIDE"].includes(action)) throw new Error("Choose a supported failover action.");
  const policyId = text(input.policyId, 120);
  if (!policyId) throw new Error("Choose a failover policy.");
  if (action !== "OVERRIDE") return { action, policyId };
  const sourceId = text(input.sourceId, 120);
  const durationMinutes = clampInteger(input.durationMinutes, 5, 240, 30);
  if (!sourceId) throw new Error("Choose the live source for this override.");
  return { action, policyId, sourceId, durationMinutes };
}

export function failoverSourceAvailability(source, instant = new Date(), { freshSeconds = EXTERNAL_LIVE_HEALTH_FRESH_SECONDS } = {}) {
  const now = new Date(instant);
  if (!source || !["READY", "ACTIVE"].includes(source.status)) return { available: false, reason: "SOURCE_NOT_READY" };
  if (source.startsAt && now < new Date(source.startsAt)) return { available: false, reason: "SOURCE_WINDOW_NOT_STARTED" };
  if (source.endsAt && now >= new Date(source.endsAt)) return { available: false, reason: "SOURCE_WINDOW_ENDED" };
  if (source.healthStatus !== "HEALTHY") return { available: false, reason: `SOURCE_${source.healthStatus || "UNVERIFIED"}` };
  const checkedAt = source.lastHealthCheckedAt ? new Date(source.lastHealthCheckedAt) : null;
  if (!checkedAt || now.getTime() - checkedAt.getTime() > freshSeconds * 1_000) return { available: false, reason: "SOURCE_HEALTH_STALE" };
  return { available: true, reason: null };
}

function result(policy, updates, kind = null) {
  const next = {
    state: updates.state,
    effectiveSourceId: updates.effectiveSourceId ?? null,
    manualSourceId: updates.manualSourceId ?? null,
    manualOverrideUntil: updates.manualOverrideUntil ?? null,
    primaryHealthySince: updates.primaryHealthySince ?? null,
    recoveryHealthyProbes: updates.recoveryHealthyProbes ?? 0,
    lastTransitionReason: updates.reason
  };
  const changed = policy.state !== next.state || (policy.effectiveSourceId || null) !== next.effectiveSourceId || (policy.manualSourceId || null) !== next.manualSourceId;
  return { ...next, kind: changed ? kind : null, changed };
}

export function decideLiveFailover(policy, { primary, backup = null, manual = null }, instant = new Date()) {
  const now = new Date(instant);
  const primaryHealth = failoverSourceAvailability(primary, now);
  const backupHealth = failoverSourceAvailability(backup, now);
  const manualHealth = failoverSourceAvailability(manual, now);
  const overrideActive = Boolean(policy.manualSourceId && policy.manualOverrideUntil && new Date(policy.manualOverrideUntil) > now);

  if (overrideActive && manualHealth.available) {
    return result(policy, {
      state: "MANUAL_OVERRIDE",
      effectiveSourceId: manual.id,
      manualSourceId: manual.id,
      manualOverrideUntil: policy.manualOverrideUntil,
      reason: "MANUAL_OVERRIDE_HEALTHY"
    }, "MANUAL_SOURCE_SELECTED");
  }

  const overrideCleared = Boolean(policy.manualSourceId);
  const failureThreshold = clampInteger(policy.failureThreshold, 1, 5, 2);
  const recoveryThreshold = clampInteger(policy.recoveryThreshold, 1, 5, 3);
  const recoveryHoldSeconds = clampInteger(policy.recoveryHoldSeconds, 30, 600, 60);

  if (primaryHealth.available) {
    const wasAwayFromPrimary = !["PRIMARY"].includes(policy.state) || policy.effectiveSourceId !== primary.id;
    if (!wasAwayFromPrimary) {
      return result(policy, { state: "PRIMARY", effectiveSourceId: primary.id, reason: "PRIMARY_HEALTHY" });
    }
    const healthySince = policy.primaryHealthySince ? new Date(policy.primaryHealthySince) : now;
    const healthyProbes = (policy.state === "RECOVERY_PENDING" ? policy.recoveryHealthyProbes || 0 : 0) + 1;
    const heldLongEnough = now.getTime() - healthySince.getTime() >= recoveryHoldSeconds * 1_000;
    if (healthyProbes >= recoveryThreshold && heldLongEnough) {
      return result(policy, { state: "PRIMARY", effectiveSourceId: primary.id, reason: "PRIMARY_RECOVERED_AFTER_HYSTERESIS" }, "PRIMARY_RECOVERED");
    }
    return result(policy, {
      state: "RECOVERY_PENDING",
      effectiveSourceId: backupHealth.available ? backup.id : null,
      primaryHealthySince: healthySince,
      recoveryHealthyProbes: healthyProbes,
      reason: backupHealth.available ? "PRIMARY_RECOVERY_BEING_CONFIRMED" : "PRIMARY_RECOVERY_PENDING_WITH_SCHEDULED_FALLBACK"
    }, overrideCleared ? "MANUAL_OVERRIDE_CLEARED" : "PRIMARY_RECOVERY_PENDING");
  }

  if ((primary?.consecutiveFailures || 0) < failureThreshold) {
    return result(policy, {
      state: "SCHEDULED_FALLBACK",
      effectiveSourceId: null,
      reason: `PRIMARY_FAILURE_CONFIRMATION_${primary?.consecutiveFailures || 0}_OF_${failureThreshold}`
    }, "PROGRAMMING_FALLBACK_SELECTED");
  }
  if (backupHealth.available) {
    return result(policy, { state: "BACKUP", effectiveSourceId: backup.id, reason: `PRIMARY_FAILED_${primaryHealth.reason}` }, "BACKUP_SELECTED");
  }
  return result(policy, {
    state: "SCHEDULED_FALLBACK",
    effectiveSourceId: null,
    reason: backup ? `PRIMARY_AND_BACKUP_UNAVAILABLE_${backupHealth.reason}` : "PRIMARY_UNAVAILABLE_NO_BACKUP"
  }, "PROGRAMMING_FALLBACK_SELECTED");
}

export function liveFailoverCandidate(policy, { organisationId, channelId, instant = new Date() }) {
  if (!policy?.enabled) return null;
  const source = policy.effectiveSource || null;
  if (!source) {
    return {
      organisationId,
      channelId,
      sourceType: "LIVE_SESSION",
      sourceId: policy.primarySourceId,
      sourceRevision: `${policy.id}:${new Date(policy.updatedAt || instant).toISOString()}`,
      label: "External Live failover",
      available: false,
      unavailableReason: policy.lastTransitionReason || "LIVE_FAILOVER_TO_PROGRAMMING",
      validFrom: new Date(instant),
      validUntil: new Date(new Date(instant).getTime() + 60_000),
      proofClassification: "LIVE",
      payload: null
    };
  }
  const candidate = externalLiveCandidate({ ...source, status: "ACTIVE" }, { organisationId, channelId, instant });
  if (!candidate) return null;
  return {
    ...candidate,
    sourceRevision: `${candidate.sourceRevision}:${policy.id}:${policy.state}:${new Date(policy.lastTransitionAt || policy.updatedAt || instant).toISOString()}`,
    payload: candidate.payload ? { resolution: {
      ...candidate.payload.resolution,
      fallbackCause: policy.state === "PRIMARY" ? null : policy.lastTransitionReason,
      liveSource: {
        ...candidate.payload.resolution.liveSource,
        failoverPolicyId: policy.id,
        failoverState: policy.state,
        primarySourceId: policy.primarySourceId
      }
    } } : null
  };
}

export function safeLiveFailoverPolicy(policy) {
  return {
    id: policy.id,
    channel: policy.channel,
    primarySource: policy.primarySource ? { id: policy.primarySource.id, name: policy.primarySource.name } : null,
    backupSource: policy.backupSource ? { id: policy.backupSource.id, name: policy.backupSource.name } : null,
    effectiveSource: policy.effectiveSource ? { id: policy.effectiveSource.id, name: policy.effectiveSource.name } : null,
    manualSource: policy.manualSource ? { id: policy.manualSource.id, name: policy.manualSource.name } : null,
    enabled: policy.enabled,
    state: policy.state,
    failureThreshold: policy.failureThreshold,
    recoveryThreshold: policy.recoveryThreshold,
    recoveryHoldSeconds: policy.recoveryHoldSeconds,
    recoveryHealthyProbes: policy.recoveryHealthyProbes,
    manualOverrideUntil: policy.manualOverrideUntil?.toISOString?.() || policy.manualOverrideUntil || null,
    lastTransitionAt: policy.lastTransitionAt?.toISOString?.() || policy.lastTransitionAt || null,
    lastTransitionReason: policy.lastTransitionReason,
    updatedAt: policy.updatedAt?.toISOString?.() || policy.updatedAt,
    events: (policy.events || []).map((event) => ({
      id: event.id,
      kind: event.kind,
      fromSourceId: event.fromSourceId,
      toSourceId: event.toSourceId,
      reason: event.reason,
      evidence: event.evidence,
      observedAt: event.observedAt?.toISOString?.() || event.observedAt
    }))
  };
}
