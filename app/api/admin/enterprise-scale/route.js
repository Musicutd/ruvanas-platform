import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { ENTERPRISE_EVIDENCE_TYPES } from "@/lib/enterprise-scale.mjs";
import {
  ENTERPRISE_SCALE_ENTITY_TYPE,
  ENTERPRISE_SCALE_EVIDENCE_ACTION,
  enterpriseScaleEntityId,
  getEnterpriseScaleReport
} from "@/lib/enterprise-scale-service";
import { deploymentIdentity, safeOperationalErrorCode } from "@/lib/operational-observability.mjs";
import { prisma } from "@/lib/prisma";
import { getRequestId, securityLog } from "@/lib/security-log";

const WEB_IDENTITY = deploymentIdentity({ service: "WEB", startedAt: new Date() });
const evidenceType = z.enum(ENTERPRISE_EVIDENCE_TYPES.map((item) => item.id));
const metricValue = z.coerce.number().finite().nonnegative();
const requestSchema = z.object({
  action: z.literal("RECORD_EVIDENCE"),
  evidenceType,
  result: z.enum(["PASS", "FAIL"]),
  reference: z.string().trim().min(3).max(160),
  performedAt: z.coerce.date(),
  note: z.string().trim().min(8).max(500),
  metrics: z.record(z.string().trim().min(1).max(48), metricValue).refine((value) => Object.keys(value).length <= 12, "At most 12 bounded metrics may be recorded.")
});

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") return { ok: false, status: 403, error: "Super administrator access is required." };
  return access;
}

export async function GET(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    return NextResponse.json(await getEnterpriseScaleReport(prisma, { identity: WEB_IDENTITY }));
  } catch (error) {
    securityLog("error", "ENTERPRISE_SCALE_LOAD_FAILED", request, { errorCode: safeOperationalErrorCode(error, "ENTERPRISE_SCALE_LOAD_FAILED") });
    return NextResponse.json({ error: "Unable to load enterprise-scale readiness." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid scale evidence." }, { status: 400 });
    const input = parsed.data;
    const now = new Date();
    if (input.performedAt.getTime() > now.getTime() + 5 * 60_000) return NextResponse.json({ error: "Evidence time cannot be in the future." }, { status: 400 });

    await prisma.auditLog.create({
      data: {
        actorUserId: access.user.id,
        action: ENTERPRISE_SCALE_EVIDENCE_ACTION,
        entityType: ENTERPRISE_SCALE_ENTITY_TYPE,
        entityId: enterpriseScaleEntityId(WEB_IDENTITY.environment),
        details: {
          environment: WEB_IDENTITY.environment,
          evidenceType: input.evidenceType,
          result: input.result,
          reference: input.reference,
          performedAt: input.performedAt.toISOString(),
          note: input.note,
          metrics: input.metrics,
          requestId: getRequestId(request)
        }
      }
    });
    securityLog("info", ENTERPRISE_SCALE_EVIDENCE_ACTION, request, { evidenceType: input.evidenceType, result: input.result });
    return NextResponse.json({ ok: true, report: await getEnterpriseScaleReport(prisma, { identity: WEB_IDENTITY, now }) });
  } catch (error) {
    securityLog("error", "ENTERPRISE_SCALE_EVIDENCE_FAILED", request, { errorCode: safeOperationalErrorCode(error, "ENTERPRISE_SCALE_EVIDENCE_FAILED") });
    return NextResponse.json({ error: "Unable to record enterprise-scale evidence." }, { status: 500 });
  }
}
