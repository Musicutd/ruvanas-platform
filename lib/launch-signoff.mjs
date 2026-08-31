import { LAUNCH_OPERATOR_CHECKS } from "./launch-readiness.mjs";

export const LAUNCH_SIGNOFF_ACTIONS = Object.freeze({
  CONFIRM: "LAUNCH_OPERATOR_CHECK_CONFIRMED",
  REVOKE: "LAUNCH_OPERATOR_CHECK_REVOKED",
  FINALIZE: "LAUNCH_HANDOVER_SIGNED_OFF",
  WITHDRAW: "LAUNCH_HANDOVER_SIGNOFF_WITHDRAWN"
});

export const LAUNCH_OPERATOR_CHECK_IDS = Object.freeze(
  LAUNCH_OPERATOR_CHECKS.map((item) => item.id)
);

function clean(value, limit = 500) {
  return String(value || "")
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, limit);
}

export function launchEvidenceEntityId(environment, commitSha) {
  const safeEnvironment = clean(environment, 80);
  const safeCommit = clean(commitSha, 100);
  if (!safeEnvironment || !safeCommit) return null;
  return `${safeEnvironment}:${safeCommit}`;
}

export function launchSignoffState({
  events = [],
  operatorChecks = LAUNCH_OPERATOR_CHECKS,
  readinessStatus = "BLOCKED"
} = {}) {
  const checkIds = new Set(operatorChecks.map((item) => item.id));
  const confirmations = new Map(
    operatorChecks.map((item) => [item.id, {
      id: item.id,
      label: item.label,
      description: item.description,
      confirmed: false,
      confirmedAt: null,
      confirmedBy: null,
      evidenceReference: null,
      note: null
    }])
  );
  let finalSignoff = null;

  const ordered = [...events].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );

  for (const event of ordered) {
    const checkId = clean(event?.details?.checkId, 80);
    if (event.action === LAUNCH_SIGNOFF_ACTIONS.CONFIRM && checkIds.has(checkId)) {
      confirmations.set(checkId, {
        ...confirmations.get(checkId),
        confirmed: true,
        confirmedAt: event.createdAt,
        confirmedBy: clean(event.actor?.name || event.actor?.email || "Super Admin", 120),
        evidenceReference: clean(event.details?.evidenceReference, 160) || null,
        note: clean(event.details?.note, 500) || null
      });
    }
    if (event.action === LAUNCH_SIGNOFF_ACTIONS.REVOKE && checkIds.has(checkId)) {
      confirmations.set(checkId, {
        ...confirmations.get(checkId),
        confirmed: false,
        confirmedAt: null,
        confirmedBy: null,
        evidenceReference: null,
        note: clean(event.details?.note, 500) || null
      });
      finalSignoff = null;
    }
    if (event.action === LAUNCH_SIGNOFF_ACTIONS.FINALIZE) {
      finalSignoff = {
        signedOffAt: event.createdAt,
        signedOffBy: clean(event.actor?.name || event.actor?.email || "Super Admin", 120),
        launchScope: clean(event.details?.launchScope, 160),
        note: clean(event.details?.note, 500)
      };
    }
    if (event.action === LAUNCH_SIGNOFF_ACTIONS.WITHDRAW) finalSignoff = null;
  }

  const operatorConfirmations = operatorChecks.map((item) => confirmations.get(item.id));
  const allOperatorChecksConfirmed = operatorConfirmations.every((item) => item.confirmed);
  const canFinalize = readinessStatus === "READY_FOR_OPERATOR_SIGN_OFF" && allOperatorChecksConfirmed;

  return Object.freeze({
    operatorConfirmations,
    confirmedCount: operatorConfirmations.filter((item) => item.confirmed).length,
    requiredCount: operatorConfirmations.length,
    allOperatorChecksConfirmed,
    canFinalize,
    finalSignoff,
    signedOff: Boolean(finalSignoff) && canFinalize
  });
}
