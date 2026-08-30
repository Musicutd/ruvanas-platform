import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { launchReadiness } from "@/lib/launch-readiness.mjs";
import { deploymentIdentity, safeOperationalErrorCode } from "@/lib/operational-observability.mjs";
import { getOperationalHealth, recordServiceHeartbeat } from "@/lib/operational-observability-service";
import { getRecoveryReadiness } from "@/lib/recovery-readiness-service";
import { prisma } from "@/lib/prisma";
import { securityLog } from "@/lib/security-log";

const WEB_STARTED_AT = new Date();
const WEB_IDENTITY = deploymentIdentity({ service: "WEB", startedAt: WEB_STARTED_AT });

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
    }

    const now = new Date();
    await recordServiceHeartbeat(prisma, { identity: WEB_IDENTITY, now, details: { runtime: "nextjs" } });
    const [operational, recovery] = await Promise.all([
      getOperationalHealth(prisma, { now, webIdentity: WEB_IDENTITY }),
      getRecoveryReadiness(prisma, { environment: WEB_IDENTITY.environment, now })
    ]);

    return NextResponse.json({
      generatedAt: now,
      ...launchReadiness({ operational, recovery })
    });
  } catch (error) {
    securityLog("error", "LAUNCH_READINESS_LOAD_FAILED", request, {
      errorCode: safeOperationalErrorCode(error, "LAUNCH_READINESS_LOAD_FAILED")
    });
    return NextResponse.json({ error: "Unable to load launch readiness." }, { status: 500 });
  }
}
