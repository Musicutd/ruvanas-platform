import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { readPromoOnlyConfig, assertPromoOnlyDownloadAuthority } from "@/lib/promo-only.mjs";
import { importPromoOnlyAudio } from "@/lib/promo-only-download-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Promo Only audio import requires a Ruvanas Super Admin." }, { status: 403 });
  try {
    const config = readPromoOnlyConfig();
    assertPromoOnlyDownloadAuthority({ config, actorRole: access.user.role, entitlementAccepted: true });
    const result = await importPromoOnlyAudio(prisma, { distributorTrackId: params.trackId, actorUserId: access.user.id, actorRole: access.user.role, config });
    return NextResponse.json({ result: { imported: result.imported, catalogTrackId: result.trackId, reconciliationRequired: result.reconciliationRequired } });
  } catch (error) {
    return NextResponse.json({ error: "The Promo Only AUDIO_TEST import was not authorised or did not complete safely.", code: error?.code || "PROMOONLY_IMPORT_FAILED" }, { status: error?.status || 409 });
  }
}
