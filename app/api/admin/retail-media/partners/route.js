import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { requireRetailMediaOrganisation } from "@/lib/retail-media-access";
import { normaliseRetailMediaPartner } from "@/lib/retail-media.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireRetailMediaOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const partners = await prisma.retailMediaPartner.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } },
      orderBy: [{ kind: "asc" }, { name: "asc" }]
    });
    return NextResponse.json({ partners });
  } catch (error) {
    console.error("List retail-media partners error:", error);
    return NextResponse.json({ error: "Unable to load retail-media partners." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    let input;
    try { input = normaliseRetailMediaPartner(await request.json()); }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const access = await requireRetailMediaOrganisation(input.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const partner = await prisma.$transaction(async (tx) => {
      const created = await tx.retailMediaPartner.create({ data: input });
      await tx.auditLog.create({ data: {
        organisationId: input.organisationId,
        actorUserId: access.user.id,
        action: "RETAIL_MEDIA_PARTNER_CREATED",
        entityType: "RetailMediaPartner",
        entityId: created.id,
        details: { kind: created.kind, name: created.name }
      } });
      return created;
    });
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    console.error("Create retail-media partner error:", error);
    const duplicate = error?.code === "P2002";
    return NextResponse.json({ error: duplicate ? "This partner already exists for the organisation." : "Unable to create the retail-media partner." }, { status: duplicate ? 409 : 500 });
  }
}
