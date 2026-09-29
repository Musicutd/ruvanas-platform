import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { countCorrectionsPrivacyInventory } from "@/lib/corrections-privacy-inventory.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can view this inventory." }, { status: 403 });
    }

    const organisationId = new URL(request.url).searchParams.get("organisationId")?.trim();
    if (!organisationId || organisationId.length > 128) {
      return NextResponse.json({ error: "A valid organisation is required." }, { status: 400 });
    }
    const organisation = await prisma.organisation.findUnique({ where: { id: organisationId }, select: { id: true } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });

    const counts = await countCorrectionsPrivacyInventory(prisma, organisationId);
    return NextResponse.json(
      { organisationId, counts, notice: "Inventory only. These counts do not establish retention eligibility; no records were changed." },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Corrections privacy inventory failed", error);
    return NextResponse.json({ error: "Unable to prepare the Corrections privacy inventory." }, { status: 500 });
  }
}
