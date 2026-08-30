import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { deploymentIdentity, safeOperationalErrorCode } from "@/lib/operational-observability.mjs";
import { getOperationalHealth, recordServiceHeartbeat } from "@/lib/operational-observability-service";
import { prisma } from "@/lib/prisma";
import { securityLog } from "@/lib/security-log";

const WEB_STARTED_AT = new Date();
const WEB_IDENTITY = deploymentIdentity({ service: "WEB", startedAt: WEB_STARTED_AT });

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
    const now = new Date();
    await recordServiceHeartbeat(prisma, { identity: WEB_IDENTITY, now, details: { runtime: "nextjs" } });
    return NextResponse.json(await getOperationalHealth(prisma, { now, webIdentity: WEB_IDENTITY }));
  } catch (error) {
    securityLog("error", "OPERATIONAL_HEALTH_LOAD_FAILED", request, { errorCode: safeOperationalErrorCode(error, "OPERATIONAL_HEALTH_LOAD_FAILED") });
    return NextResponse.json({ error: "Unable to load operational health." }, { status: 500 });
  }
}
