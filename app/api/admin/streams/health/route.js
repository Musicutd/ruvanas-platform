import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getStreamHealthOperations } from "@/lib/stream-source-health-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    return NextResponse.json(await getStreamHealthOperations(prisma));
  } catch (error) {
    console.error("Load stream health operations error:", error);
    return NextResponse.json({ error: "Unable to load stream source health." }, { status: 500 });
  }
}
