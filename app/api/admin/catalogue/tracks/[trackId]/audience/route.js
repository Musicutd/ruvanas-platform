import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { parseCatalogueAudience } from "@/lib/catalogue-audience.mjs";
import { catalogueTerritoriesWithinApprovedScope } from "@/lib/catalogue-territories.mjs";

export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can change catalogue access." }, { status: 403 });

  let input;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Enter a tier and at least one pillar." }, { status: 400 }); }
  const audience = parseCatalogueAudience(input);
  if (!audience.ok) return NextResponse.json({ error: audience.error }, { status: 400 });
  if (input?.rightsConfirmed !== true) return NextResponse.json({ error: "Confirm that the recorded licence covers the selected pillars and tier." }, { status: 400 });

  const { trackId } = await params;
  const track = await prisma.track.findFirst({
    where: { id: trackId, mediaAsset: { libraryType: "RUVANAS_CATALOGUE", organisationId: null } },
    select: { id: true, minimumCatalogueLevel: true, permittedUses: true, permittedTerritories: true,
      catalogueProvider: true, distributorItems: { select: { permittedTerritories: true } } }
  });
  if (!track) return NextResponse.json({ error: "Catalogue track not found." }, { status: 404 });
  if (track.catalogueProvider && (!track.distributorItems.length || track.distributorItems.some((item) => !catalogueTerritoriesWithinApprovedScope(audience.data.permittedTerritories, item.permittedTerritories)))) {
    return NextResponse.json({ error: "Choose territories within the provider-approved scope. Broader access needs a separate rights review." }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.track.update({ where: { id: track.id }, data: audience.data, select: { id: true, minimumCatalogueLevel: true, permittedUses: true, permittedTerritories: true } });
    await tx.auditLog.create({ data: {
      actorUserId: access.user.id,
      action: "CATALOGUE_TRACK_AUDIENCE_UPDATED",
      entityType: "Track",
      entityId: track.id,
      details: { before: { minimumCatalogueLevel: track.minimumCatalogueLevel, permittedUses: track.permittedUses, permittedTerritories: track.permittedTerritories }, after: audience.data }
    } });
    return saved;
  });
  return NextResponse.json({ track: updated }, { headers: { "Cache-Control": "no-store" } });
}
