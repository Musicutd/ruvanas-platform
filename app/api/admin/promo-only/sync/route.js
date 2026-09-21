import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { readPromoOnlyConfig } from "@/lib/promo-only.mjs";
import { ensurePromoOnlyConnection, runPromoOnlySync } from "@/lib/promo-only-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin may run Promo Only synchronisation." }, { status: 403 });
  try {
    const config = readPromoOnlyConfig();
    if (!config.enabled || config.mode === "OFF") return NextResponse.json({ error: "Promo Only sync is disabled by server configuration." }, { status: 409 });
    const connection = await ensurePromoOnlyConnection(prisma, { actorUserId: access.user.id, config });
    const leaseOwner = `manual:${access.user.id}:${crypto.randomUUID()}`;
    const now = new Date();
    const claimed = await prisma.musicDistributorConnection.updateMany({ where: { id: connection.id, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: now } }] }, data: { syncLeaseOwner: leaseOwner, syncLeaseUntil: new Date(now.getTime() + 60 * 60_000) } });
    if (claimed.count !== 1) return NextResponse.json({ error: "Promo Only sync is already running. Try again after it finishes." }, { status: 409 });
    try {
      const result = await runPromoOnlySync(prisma, { actorUserId: access.user.id, trigger: "MANUAL", config });
      return NextResponse.json({ result });
    } finally {
      await prisma.musicDistributorConnection.updateMany({ where: { id: connection.id, syncLeaseOwner: leaseOwner }, data: { syncLeaseOwner: null, syncLeaseUntil: null } });
    }
  } catch (error) {
    const status = ["PROMOONLY_DISABLED", "PROMOONLY_SETUP_REQUIRED", "PROMOONLY_CREDENTIALS_REQUIRED"].includes(error?.code) ? 409 : 502;
    return NextResponse.json({ error: "Promo Only sync did not complete. Check the safe error code and sync history.", code: error?.code || "PROMOONLY_SYNC_FAILED" }, { status });
  }
}
