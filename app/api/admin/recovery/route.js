import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { deploymentIdentity, safeOperationalErrorCode } from "@/lib/operational-observability.mjs";
import { getRecoveryReadiness } from "@/lib/recovery-readiness-service";
import { normalizeRecoveryControl, normalizeRecoveryEvidence } from "@/lib/recovery-readiness.mjs";
import { prisma } from "@/lib/prisma";
import { getRequestId, securityLog } from "@/lib/security-log";

const assetKind = z.enum(["DATABASE", "OBJECT_STORAGE"]);
const controlSchema = z.object({
  action: z.literal("UPDATE_CONTROL"),
  assetKind,
  strategyConfirmed: z.boolean(),
  automatedBackupConfirmed: z.boolean(),
  versioningConfirmed: z.boolean().optional(),
  targetRpoMinutes: z.union([z.number(), z.string(), z.null()]).optional(),
  targetRtoMinutes: z.union([z.number(), z.string(), z.null()]).optional(),
  retentionDays: z.union([z.number(), z.string(), z.null()]).optional(),
  notes: z.string().trim().min(8).max(500)
});
const evidenceSchema = z.object({
  action: z.literal("RECORD_EVIDENCE"),
  assetKind,
  evidenceKind: z.enum(["BACKUP_VERIFICATION", "RESTORE_DRILL"]),
  result: z.enum(["PASSED", "PARTIAL", "FAILED"]),
  evidenceReference: z.string().trim().min(3).max(160),
  performedAt: z.string().datetime(),
  backupCapturedAt: z.string().datetime().nullable().optional(),
  restoreCompletedMinutes: z.union([z.number(), z.string(), z.null()]).optional(),
  notes: z.string().trim().min(8).max(500)
});
const requestSchema = z.discriminatedUnion("action", [controlSchema, evidenceSchema]);

function currentEnvironment() {
  return deploymentIdentity({ service: "WEB" }).environment;
}

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") return { ok: false, status: 403, error: "Only a Ruvanas Super Admin can manage recovery readiness." };
  return access;
}

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    return NextResponse.json(await getRecoveryReadiness(prisma, { environment: currentEnvironment() }));
  } catch (error) {
    securityLog("error", "RECOVERY_READINESS_LOAD_FAILED", request, { errorCode: safeOperationalErrorCode(error, "RECOVERY_READINESS_LOAD_FAILED") });
    return NextResponse.json({ error: "Unable to load backup and recovery readiness." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid recovery operation." }, { status: 400 });
    const environment = currentEnvironment();
    const requestId = getRequestId(request);
    const now = new Date();

    if (parsed.data.action === "UPDATE_CONTROL") {
      const normalized = normalizeRecoveryControl(parsed.data, now);
      const control = await prisma.$transaction(async (tx) => {
        const saved = await tx.recoveryControl.upsert({
          where: { assetKind_environment: { assetKind: normalized.assetKind, environment } },
          create: { ...normalized, environment, updatedByUserId: access.user.id },
          update: { ...normalized, updatedByUserId: access.user.id }
        });
        await tx.auditLog.create({ data: { actorUserId: access.user.id, action: "RECOVERY_CONTROL_UPDATED", entityType: "RecoveryControl", entityId: saved.id, details: { assetKind: saved.assetKind, environment, strategyConfirmed: saved.strategyConfirmed, automatedBackupConfirmed: saved.automatedBackupConfirmed, versioningConfirmed: saved.versioningConfirmed, targetRpoMinutes: saved.targetRpoMinutes, targetRtoMinutes: saved.targetRtoMinutes, retentionDays: saved.retentionDays, requestId } } });
        return saved;
      });
      return NextResponse.json({ ok: true, control });
    }

    const normalized = normalizeRecoveryEvidence(parsed.data, now);
    const existingControl = await prisma.recoveryControl.findUnique({ where: { assetKind_environment: { assetKind: normalized.assetKind, environment } } });
    if (!existingControl?.strategyConfirmed) return NextResponse.json({ error: "Confirm and save this recovery strategy before recording evidence." }, { status: 409 });
    const evidence = await prisma.$transaction(async (tx) => {
      const saved = await tx.recoveryEvidence.create({ data: { ...normalized, recoveryControlId: existingControl.id, environment, recordedByUserId: access.user.id } });
      await tx.auditLog.create({ data: { actorUserId: access.user.id, action: "RECOVERY_EVIDENCE_RECORDED", entityType: "RecoveryEvidence", entityId: saved.id, details: { assetKind: saved.assetKind, environment, evidenceKind: saved.evidenceKind, result: saved.result, evidenceReference: saved.evidenceReference, performedAt: saved.performedAt, requestId } } });
      return saved;
    });
    return NextResponse.json({ ok: true, evidence }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This evidence reference is already recorded for the current environment." }, { status: 409 });
    if (error instanceof Error && /must|Choose|Confirm|Add|Use|cannot|applies/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    securityLog("error", "RECOVERY_READINESS_OPERATION_FAILED", request, { errorCode: safeOperationalErrorCode(error, "RECOVERY_READINESS_OPERATION_FAILED") });
    return NextResponse.json({ error: "Unable to complete the recovery operation." }, { status: 500 });
  }
}
