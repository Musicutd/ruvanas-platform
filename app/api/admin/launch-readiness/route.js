import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { launchReadiness } from "@/lib/launch-readiness.mjs";
import {
  LAUNCH_OPERATOR_CHECK_IDS,
  LAUNCH_SIGNOFF_ACTIONS,
  launchEvidenceEntityId,
  launchSignoffState
} from "@/lib/launch-signoff.mjs";
import { deploymentIdentity, safeOperationalErrorCode } from "@/lib/operational-observability.mjs";
import { getOperationalHealth, recordServiceHeartbeat } from "@/lib/operational-observability-service";
import { getRecoveryReadiness } from "@/lib/recovery-readiness-service";
import { prisma } from "@/lib/prisma";
import { getRequestId, securityLog } from "@/lib/security-log";

const WEB_STARTED_AT = new Date();
const WEB_IDENTITY = deploymentIdentity({ service: "WEB", startedAt: WEB_STARTED_AT });
const checkId = z.enum(LAUNCH_OPERATOR_CHECK_IDS);
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CONFIRM_CHECK"),
    checkId,
    evidenceReference: z.string().trim().min(3).max(160),
    note: z.string().trim().min(8).max(500)
  }),
  z.object({
    action: z.literal("REVOKE_CHECK"),
    checkId,
    note: z.string().trim().min(8).max(500)
  }),
  z.object({
    action: z.literal("FINALIZE_SIGNOFF"),
    launchScope: z.string().trim().min(3).max(160),
    note: z.string().trim().min(8).max(500)
  }),
  z.object({
    action: z.literal("WITHDRAW_SIGNOFF"),
    note: z.string().trim().min(8).max(500)
  })
]);
const signoffActions = Object.values(LAUNCH_SIGNOFF_ACTIONS);

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") {
    return { ok: false, status: 403, error: "Super administrator access is required." };
  }
  return access;
}

async function readinessReport(now = new Date()) {
  await recordServiceHeartbeat(prisma, { identity: WEB_IDENTITY, now, details: { runtime: "nextjs" } });
  const [operational, recovery] = await Promise.all([
    getOperationalHealth(prisma, { now, webIdentity: WEB_IDENTITY }),
    getRecoveryReadiness(prisma, { environment: WEB_IDENTITY.environment, now })
  ]);
  const report = launchReadiness({ operational, recovery });
  const entityId = launchEvidenceEntityId(WEB_IDENTITY.environment, report.deployment.commitSha);
  const events = entityId ? await prisma.auditLog.findMany({
    where: { entityType: "LaunchReadiness", entityId, action: { in: signoffActions } },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200
  }) : [];
  return {
    generatedAt: now,
    ...report,
    signoff: launchSignoffState({ events, readinessStatus: report.status })
  };
}

export async function GET(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    return NextResponse.json(await readinessReport());
  } catch (error) {
    securityLog("error", "LAUNCH_READINESS_LOAD_FAILED", request, {
      errorCode: safeOperationalErrorCode(error, "LAUNCH_READINESS_LOAD_FAILED")
    });
    return NextResponse.json({ error: "Unable to load launch readiness." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid sign-off operation." }, { status: 400 });
    }

    const report = await readinessReport();
    const entityId = launchEvidenceEntityId(WEB_IDENTITY.environment, report.deployment.commitSha);
    if (!entityId) return NextResponse.json({ error: "The active paid release is not attributable to a commit." }, { status: 409 });
    const requestId = getRequestId(request);
    const data = parsed.data;

    if (data.action === "FINALIZE_SIGNOFF") {
      if (!report.signoff.canFinalize) {
        return NextResponse.json({ error: "Resolve every automated blocker and confirm every operator check before final sign-off." }, { status: 409 });
      }
      if (report.signoff.signedOff) return NextResponse.json({ error: "This release is already signed off." }, { status: 409 });
    }
    if (data.action === "WITHDRAW_SIGNOFF" && !report.signoff.finalSignoff) {
      return NextResponse.json({ error: "There is no current sign-off to withdraw." }, { status: 409 });
    }

    const action = {
      CONFIRM_CHECK: LAUNCH_SIGNOFF_ACTIONS.CONFIRM,
      REVOKE_CHECK: LAUNCH_SIGNOFF_ACTIONS.REVOKE,
      FINALIZE_SIGNOFF: LAUNCH_SIGNOFF_ACTIONS.FINALIZE,
      WITHDRAW_SIGNOFF: LAUNCH_SIGNOFF_ACTIONS.WITHDRAW
    }[data.action];
    await prisma.auditLog.create({
      data: {
        actorUserId: access.user.id,
        action,
        entityType: "LaunchReadiness",
        entityId,
        details: {
          environment: WEB_IDENTITY.environment,
          commitSha: report.deployment.commitSha,
          checkId: data.checkId || null,
          evidenceReference: data.evidenceReference || null,
          launchScope: data.launchScope || null,
          note: data.note,
          requestId
        }
      }
    });

    securityLog("info", action, request, {
      entityId,
      checkId: data.checkId || null,
      requestId
    });
    return NextResponse.json({ ok: true, report: await readinessReport() });
  } catch (error) {
    securityLog("error", "LAUNCH_SIGNOFF_OPERATION_FAILED", request, {
      errorCode: safeOperationalErrorCode(error, "LAUNCH_SIGNOFF_OPERATION_FAILED")
    });
    return NextResponse.json({ error: "Unable to complete the launch sign-off operation." }, { status: 500 });
  }
}
