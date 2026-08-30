import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  normalizeRecoveryControl,
  normalizeRecoveryEvidence,
  recoveryReadiness
} from "../lib/recovery-readiness.mjs";
import { getRecoveryReadiness } from "../lib/recovery-readiness-service.js";

const now = new Date("2026-08-30T12:00:00.000Z");

test("recovery controls require confirmed strategies before RPO and RTO targets", () => {
  assert.throws(() => normalizeRecoveryControl({ assetKind: "DATABASE", strategyConfirmed: false, targetRpoMinutes: 60, notes: "Provider review completed." }, now), /Confirm the recovery strategy/);
  assert.throws(() => normalizeRecoveryControl({ assetKind: "DATABASE", strategyConfirmed: true, versioningConfirmed: true, notes: "Provider review completed." }, now), /Versioning confirmation applies/);
  const control = normalizeRecoveryControl({ assetKind: "DATABASE", strategyConfirmed: true, automatedBackupConfirmed: true, targetRpoMinutes: 60, targetRtoMinutes: 120, retentionDays: 30, notes: " Managed backup settings verified.\n" }, now);
  assert.equal(control.assetKind, "DATABASE");
  assert.equal(control.notes, "Managed backup settings verified.");
  assert.equal(control.nextReviewAt.toISOString(), "2026-11-28T12:00:00.000Z");
});

test("recovery evidence rejects unsafe references and inconsistent fields", () => {
  assert.throws(() => normalizeRecoveryEvidence({ assetKind: "DATABASE", evidenceKind: "BACKUP_VERIFICATION", result: "PASSED", evidenceReference: "https://provider.example/snapshot?token=secret", performedAt: now, notes: "Verified without copying credentials." }, now), /safe evidence reference/);
  assert.throws(() => normalizeRecoveryEvidence({ assetKind: "DATABASE", evidenceKind: "RESTORE_DRILL", result: "PASSED", evidenceReference: "restore-drill-001", performedAt: now, notes: "Isolated restore completed safely." }, now), /restore duration/);
  const evidence = normalizeRecoveryEvidence({ assetKind: "OBJECT_STORAGE", evidenceKind: "RESTORE_DRILL", result: "PASSED", evidenceReference: "object-restore-2026-08-30", performedAt: now, backupCapturedAt: "2026-08-30T11:30:00.000Z", restoreCompletedMinutes: 20, notes: "Isolated restore completed safely." }, now);
  assert.equal(evidence.restoreCompletedMinutes, 20);
});

test("readiness distinguishes missing evidence, overdue drills, and achieved targets", () => {
  const controls = [
    { assetKind: "DATABASE", strategyConfirmed: true, automatedBackupConfirmed: true, versioningConfirmed: false, targetRpoMinutes: 60, targetRtoMinutes: 120 },
    { assetKind: "OBJECT_STORAGE", strategyConfirmed: true, automatedBackupConfirmed: false, versioningConfirmed: true, targetRpoMinutes: 120, targetRtoMinutes: 180 }
  ];
  const completeEvidence = controls.flatMap((control) => [
    { assetKind: control.assetKind, evidenceKind: "BACKUP_VERIFICATION", result: "PASSED", performedAt: "2026-08-30T11:45:00.000Z", backupCapturedAt: "2026-08-30T11:30:00.000Z" },
    { assetKind: control.assetKind, evidenceKind: "RESTORE_DRILL", result: "PASSED", performedAt: "2026-08-15T10:00:00.000Z", restoreCompletedMinutes: 45 }
  ]);
  const ready = recoveryReadiness({ controls, evidence: completeEvidence, now });
  assert.equal(ready.status, "READY");
  assert.deepEqual(ready.findings, []);
  const missing = recoveryReadiness({ controls: [], evidence: [], now });
  assert.equal(missing.status, "NOT_READY");
  assert.ok(missing.findings.some((item) => item.code === "RECOVERY_STRATEGY_UNCONFIRMED"));
  const overdue = recoveryReadiness({ controls, evidence: completeEvidence.map((item) => item.evidenceKind === "RESTORE_DRILL" ? { ...item, performedAt: "2026-01-01T00:00:00.000Z" } : item), now });
  assert.equal(overdue.status, "ATTENTION");
  assert.equal(overdue.findings.filter((item) => item.code === "RESTORE_DRILL_OVERDUE").length, 2);
});

test("database readiness report remains environment-scoped and exposes safe evidence only", { skip: process.env.RUN_DATABASE_TESTS !== "1" }, async () => {
  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  const suffix = randomUUID();
  const environment = `stage-12d-${suffix}`;
  const user = await database.user.create({ data: { email: `recovery-${suffix}@example.test`, passwordHash: "test-only", name: "Recovery tester", role: "SUPER_ADMIN" } });
  try {
    for (const assetKind of ["DATABASE", "OBJECT_STORAGE"]) {
      const control = await database.recoveryControl.create({ data: { assetKind, environment, strategyConfirmed: true, automatedBackupConfirmed: assetKind === "DATABASE", versioningConfirmed: assetKind === "OBJECT_STORAGE", targetRpoMinutes: 60, targetRtoMinutes: 120, retentionDays: 30, notes: "Verified test strategy.", reviewedAt: now, nextReviewAt: new Date("2026-11-28T12:00:00.000Z"), updatedByUserId: user.id } });
      await database.recoveryEvidence.createMany({ data: [
        { recoveryControlId: control.id, assetKind, environment, evidenceKind: "BACKUP_VERIFICATION", result: "PASSED", evidenceReference: `${assetKind.toLowerCase()}-backup-${suffix}`, performedAt: new Date("2026-08-30T11:45:00.000Z"), backupCapturedAt: new Date("2026-08-30T11:30:00.000Z"), notes: "Backup verified in isolated test.", recordedByUserId: user.id },
        { recoveryControlId: control.id, assetKind, environment, evidenceKind: "RESTORE_DRILL", result: "PASSED", evidenceReference: `${assetKind.toLowerCase()}-restore-${suffix}`, performedAt: new Date("2026-08-15T10:00:00.000Z"), backupCapturedAt: new Date("2026-08-15T09:30:00.000Z"), restoreCompletedMinutes: 45, notes: "Restore drill completed in isolation.", recordedByUserId: user.id }
      ] });
    }
    const report = await getRecoveryReadiness(database, { environment, now });
    assert.equal(report.status, "READY");
    assert.equal(report.assets.length, 2);
    assert.equal(report.assets.every((asset) => asset.evidence.length === 2), true);
    assert.equal(JSON.stringify(report).includes("password"), false);
    assert.equal(JSON.stringify(report).includes("@example.test"), false);
  } finally {
    await database.recoveryEvidence.deleteMany({ where: { environment } });
    await database.recoveryControl.deleteMany({ where: { environment } });
    await database.user.delete({ where: { id: user.id } });
    await database.$disconnect();
  }
});
