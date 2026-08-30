export const RECOVERY_ASSET_KINDS = Object.freeze(["DATABASE", "OBJECT_STORAGE"]);
export const RECOVERY_EVIDENCE_KINDS = Object.freeze(["BACKUP_VERIFICATION", "RESTORE_DRILL"]);
export const RECOVERY_RESULTS = Object.freeze(["PASSED", "PARTIAL", "FAILED"]);

export const BACKUP_MAX_AGE_HOURS = Object.freeze({
  DATABASE: 48,
  OBJECT_STORAGE: 168
});

export const RESTORE_DRILL_MAX_AGE_DAYS = 90;

function boundedText(value, limit) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, limit);
}

function boundedInteger(value, { min, max, label, nullable = false }) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}

function validDate(value, label, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return parsed;
}

export function normalizeRecoveryControl(input, now = new Date()) {
  const assetKind = boundedText(input.assetKind, 40).toUpperCase();
  if (!RECOVERY_ASSET_KINDS.includes(assetKind)) throw new Error("Choose a supported recovery asset.");
  if (assetKind === "DATABASE" && Boolean(input.versioningConfirmed)) throw new Error("Versioning confirmation applies only to protected object storage.");
  const strategyConfirmed = Boolean(input.strategyConfirmed);
  const automatedBackupConfirmed = Boolean(input.automatedBackupConfirmed);
  const versioningConfirmed = assetKind === "OBJECT_STORAGE" && Boolean(input.versioningConfirmed);
  const targetRpoMinutes = boundedInteger(input.targetRpoMinutes, { min: 5, max: 43_200, label: "RPO", nullable: true });
  const targetRtoMinutes = boundedInteger(input.targetRtoMinutes, { min: 5, max: 43_200, label: "RTO", nullable: true });
  const retentionDays = boundedInteger(input.retentionDays, { min: 1, max: 3_650, label: "Retention", nullable: true });
  const notes = boundedText(input.notes, 500);
  if (!notes || notes.length < 8) throw new Error("Add an operational note of at least eight characters.");
  if (!strategyConfirmed && (targetRpoMinutes || targetRtoMinutes)) throw new Error("Confirm the recovery strategy before recording RPO or RTO targets.");
  return {
    assetKind,
    strategyConfirmed,
    automatedBackupConfirmed,
    versioningConfirmed,
    targetRpoMinutes,
    targetRtoMinutes,
    retentionDays,
    reviewedAt: new Date(now),
    nextReviewAt: new Date(new Date(now).getTime() + 90 * 24 * 60 * 60_000),
    notes
  };
}

export function normalizeRecoveryEvidence(input, now = new Date()) {
  const assetKind = boundedText(input.assetKind, 40).toUpperCase();
  const evidenceKind = boundedText(input.evidenceKind, 40).toUpperCase();
  const result = boundedText(input.result, 20).toUpperCase();
  if (!RECOVERY_ASSET_KINDS.includes(assetKind)) throw new Error("Choose a supported recovery asset.");
  if (!RECOVERY_EVIDENCE_KINDS.includes(evidenceKind)) throw new Error("Choose a supported recovery evidence type.");
  if (!RECOVERY_RESULTS.includes(result)) throw new Error("Choose a supported recovery result.");
  const evidenceReference = boundedText(input.evidenceReference, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(evidenceReference)) {
    throw new Error("Use a safe evidence reference without credentials, query strings, or private provider links.");
  }
  const performedAt = validDate(input.performedAt, "Performed time");
  if (performedAt.getTime() > new Date(now).getTime() + 5 * 60_000) throw new Error("Performed time cannot be in the future.");
  const backupCapturedAt = validDate(input.backupCapturedAt, "Backup capture time", { nullable: true });
  if (backupCapturedAt && backupCapturedAt > performedAt) throw new Error("Backup capture time cannot be later than the verification or drill.");
  const restoreCompletedMinutes = boundedInteger(input.restoreCompletedMinutes, { min: 1, max: 43_200, label: "Restore duration", nullable: true });
  if (evidenceKind === "RESTORE_DRILL" && restoreCompletedMinutes === null) throw new Error("Record the restore duration for a restore drill.");
  if (evidenceKind === "BACKUP_VERIFICATION" && restoreCompletedMinutes !== null) throw new Error("Restore duration applies only to restore drills.");
  const notes = boundedText(input.notes, 500);
  if (!notes || notes.length < 8) throw new Error("Add an operational note of at least eight characters.");
  return { assetKind, evidenceKind, result, evidenceReference, performedAt, backupCapturedAt, restoreCompletedMinutes, notes };
}

function ageHours(date, now) {
  return date ? Math.max(0, (new Date(now).getTime() - new Date(date).getTime()) / 3_600_000) : null;
}

export function recoveryReadiness({ controls = [], evidence = [], now = new Date() } = {}) {
  const findings = [];
  const assets = RECOVERY_ASSET_KINDS.map((assetKind) => {
    const control = controls.find((item) => item.assetKind === assetKind) || null;
    const records = evidence.filter((item) => item.assetKind === assetKind).sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime());
    const latestBackup = records.find((item) => item.evidenceKind === "BACKUP_VERIFICATION") || null;
    const latestSuccessfulBackup = records.find((item) => item.evidenceKind === "BACKUP_VERIFICATION" && item.result === "PASSED") || null;
    const latestDrill = records.find((item) => item.evidenceKind === "RESTORE_DRILL") || null;
    const latestSuccessfulDrill = records.find((item) => item.evidenceKind === "RESTORE_DRILL" && item.result === "PASSED") || null;
    const backupAgeHours = ageHours(latestSuccessfulBackup?.performedAt, now);
    const drillAgeDays = ageHours(latestSuccessfulDrill?.performedAt, now) / 24;

    if (!control?.strategyConfirmed) findings.push({ severity: "CRITICAL", code: "RECOVERY_STRATEGY_UNCONFIRMED", assetKind });
    if (control?.nextReviewAt && new Date(control.nextReviewAt) < new Date(now)) findings.push({ severity: "WARNING", code: "RECOVERY_CONTROL_REVIEW_OVERDUE", assetKind });
    if (assetKind === "DATABASE" && !control?.automatedBackupConfirmed) findings.push({ severity: "CRITICAL", code: "AUTOMATED_BACKUP_UNCONFIRMED", assetKind });
    if (assetKind === "OBJECT_STORAGE" && !control?.automatedBackupConfirmed && !control?.versioningConfirmed) findings.push({ severity: "CRITICAL", code: "OBJECT_RECOVERY_UNCONFIRMED", assetKind });
    if (!latestSuccessfulBackup) findings.push({ severity: "CRITICAL", code: "BACKUP_VERIFICATION_MISSING", assetKind });
    else if (backupAgeHours > BACKUP_MAX_AGE_HOURS[assetKind]) findings.push({ severity: "WARNING", code: "BACKUP_VERIFICATION_STALE", assetKind });
    if (latestBackup?.result === "FAILED") findings.push({ severity: "CRITICAL", code: "LATEST_BACKUP_VERIFICATION_FAILED", assetKind });
    if (latestBackup?.result === "PARTIAL") findings.push({ severity: "WARNING", code: "LATEST_BACKUP_VERIFICATION_PARTIAL", assetKind });
    if (!latestSuccessfulDrill) findings.push({ severity: "WARNING", code: "RESTORE_DRILL_MISSING", assetKind });
    else if (drillAgeDays > RESTORE_DRILL_MAX_AGE_DAYS) findings.push({ severity: "WARNING", code: "RESTORE_DRILL_OVERDUE", assetKind });
    if (latestDrill?.result === "FAILED") findings.push({ severity: "CRITICAL", code: "LATEST_RESTORE_DRILL_FAILED", assetKind });
    if (latestDrill?.result === "PARTIAL") findings.push({ severity: "WARNING", code: "LATEST_RESTORE_DRILL_PARTIAL", assetKind });
    if (control?.strategyConfirmed && (!control.targetRpoMinutes || !control.targetRtoMinutes)) findings.push({ severity: "WARNING", code: "RECOVERY_TARGETS_UNCONFIRMED", assetKind });
    if (latestSuccessfulBackup?.backupCapturedAt && control?.targetRpoMinutes) {
      const sourceAgeMinutes = (new Date(latestSuccessfulBackup.performedAt).getTime() - new Date(latestSuccessfulBackup.backupCapturedAt).getTime()) / 60_000;
      if (sourceAgeMinutes > control.targetRpoMinutes) findings.push({ severity: "WARNING", code: "RPO_TARGET_MISSED", assetKind });
    }
    if (latestSuccessfulDrill?.restoreCompletedMinutes && control?.targetRtoMinutes && latestSuccessfulDrill.restoreCompletedMinutes > control.targetRtoMinutes) findings.push({ severity: "WARNING", code: "RTO_TARGET_MISSED", assetKind });

    return { assetKind, control, latestBackup, latestSuccessfulBackup, latestDrill, latestSuccessfulDrill, backupAgeHours, drillAgeDays };
  });
  const status = findings.some((item) => item.severity === "CRITICAL") ? "NOT_READY" : findings.length ? "ATTENTION" : "READY";
  return { status, findings, assets };
}
