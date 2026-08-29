import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";
import { normaliseDigitalSignageLayout } from "@/lib/digital-signage.mjs";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireDigitalSignageOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const layouts = await prisma.digitalSignageLayout.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } },
      include: { regions: { orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }] } },
      orderBy: { updatedAt: "desc" }
    });
    return NextResponse.json({ layouts });
  } catch (error) {
    console.error("List digital signage layouts error:", error);
    return NextResponse.json({ error: "Unable to load signage layouts." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    let input;
    try { input = normaliseDigitalSignageLayout(await request.json()); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid layout." }, { status: 400 }); }
    const access = await requireDigitalSignageOrganisation(input.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);

    const layout = await prisma.$transaction(async (tx) => {
      const created = await tx.digitalSignageLayout.create({ data: {
        organisationId: input.organisationId,
        name: input.name,
        description: input.description,
        orientation: input.orientation,
        canvasWidth: input.canvasWidth,
        canvasHeight: input.canvasHeight,
        backgroundColor: input.backgroundColor,
        createdByUserId: access.user.id,
        regions: { create: input.regions }
      }, include: { regions: true } });
      await tx.auditLog.create({ data: {
        organisationId: input.organisationId,
        actorUserId: access.user.id,
        action: "DIGITAL_SIGNAGE_LAYOUT_CREATED",
        entityType: "DigitalSignageLayout",
        entityId: created.id,
        details: { name: created.name, orientation: created.orientation, canvasWidth: created.canvasWidth, canvasHeight: created.canvasHeight, regionCount: created.regions.length }
      } });
      return created;
    });
    return NextResponse.json({ layout }, { status: 201 });
  } catch (error) {
    console.error("Create digital signage layout error:", error);
    const status = error?.code === "P2002" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? "A layout with this name already exists." : "Unable to create the signage layout." }, { status });
  }
}
