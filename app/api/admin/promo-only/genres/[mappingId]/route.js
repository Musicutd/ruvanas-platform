import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { mergeCatalogueGenres, updateProviderGenreMapping } from "@/lib/provider-genre-service";
import { normalizePromoOnlyGenre } from "@/lib/promo-only.mjs";

const schema = z.object({
  action: z.enum(["REMAPPING", "APPROVE", "DEACTIVATE", "ACTIVATE", "RENAME", "MERGE", "ALIAS"]),
  catalogGenreId: z.string().cuid().optional(),
  name: z.string().trim().min(2).max(120).optional()
}).strict();

export async function PATCH(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin may manage provider genres." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid genre action." }, { status: 400 });
  const mapping = await prisma.musicProviderGenreMapping.findFirst({ where: { id: params.mappingId, provider: "PROMO_ONLY" }, include: { catalogGenre: true } });
  if (!mapping) return NextResponse.json({ error: "Provider genre mapping not found." }, { status: 404 });
  try {
    const { action, catalogGenreId, name } = parsed.data;
    if (action === "ALIAS") {
      const alias = name?.trim();
      if (!alias) return NextResponse.json({ error: "Enter the provider's alternate genre spelling." }, { status: 400 });
      const normalizedSourceGenre = normalizePromoOnlyGenre(alias);
      const existing = await prisma.musicProviderGenreMapping.findUnique({ where: { provider_normalizedSourceGenre: { provider: "PROMO_ONLY", normalizedSourceGenre } } });
      if (existing) return NextResponse.json({ error: "That provider genre already has a mapping. Remap it instead." }, { status: 409 });
      await prisma.musicProviderGenreMapping.create({ data: { provider: "PROMO_ONLY", sourceGenre: alias, normalizedSourceGenre, catalogGenreId: mapping.catalogGenreId, mappingType: "ALIAS", reviewStatus: "APPROVED", active: true } });
    } else if (action === "REMAPPING" || action === "MERGE") {
      if (!catalogGenreId) return NextResponse.json({ error: "Choose an existing canonical genre." }, { status: 400 });
      if (action === "MERGE") await mergeCatalogueGenres(prisma, { sourceGenreId: mapping.catalogGenreId, targetGenreId: catalogGenreId });
      else {
        const target = await prisma.mediaGenre.findFirst({ where: { id: catalogGenreId, active: true, providerReviewStatus: "APPROVED" } });
        if (!target) return NextResponse.json({ error: "Choose an approved, active Ruvanas genre." }, { status: 409 });
        const affected = await prisma.musicDistributorTrack.findMany({ where: { connection: { providerKey: "PROMO_ONLY" }, sourceGenre: { equals: mapping.sourceGenre, mode: "insensitive" } }, select: { id: true, track: { select: { mediaAssetId: true } } } });
        await prisma.$transaction(async (tx) => {
          await updateProviderGenreMapping(tx, { mappingId: mapping.id, catalogGenreId, mappingType: "MANUAL", active: true, approve: true });
          for (const item of affected) {
            await tx.musicDistributorTrack.update({ where: { id: item.id }, data: { canonicalGenreId: catalogGenreId, genreCodes: [target.slug] } });
            if (item.track?.mediaAssetId) {
              await tx.mediaAssetGenre.deleteMany({ where: { mediaAssetId: item.track.mediaAssetId, mediaGenreId: mapping.catalogGenreId } });
              await tx.mediaAssetGenre.upsert({ where: { mediaAssetId_mediaGenreId: { mediaAssetId: item.track.mediaAssetId, mediaGenreId: catalogGenreId } }, create: { mediaAssetId: item.track.mediaAssetId, mediaGenreId: catalogGenreId, isPrimary: true }, update: {} });
            }
          }
        });
      }
    } else if (action === "RENAME") {
      if (!name) return NextResponse.json({ error: "Enter a genre name." }, { status: 400 });
      await prisma.mediaGenre.update({ where: { id: mapping.catalogGenreId }, data: { name } });
    } else {
      const active = action === "APPROVE" || action === "ACTIVATE";
      await prisma.$transaction([
        prisma.musicProviderGenreMapping.update({ where: { id: mapping.id }, data: { active, ...(action === "APPROVE" ? { reviewStatus: "APPROVED" } : {}) } }),
        prisma.mediaGenre.update({ where: { id: mapping.catalogGenreId }, data: { active, ...(action === "APPROVE" ? { providerReviewStatus: "APPROVED" } : {}) } })
      ]);
    }
    await prisma.auditLog.create({ data: { actorUserId: access.user.id, action: `PROMOONLY_GENRE_${action}`, entityType: "MusicProviderGenreMapping", entityId: mapping.id, details: { sourceGenre: mapping.sourceGenre, catalogGenreId: catalogGenreId || mapping.catalogGenreId } } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "The provider genre action could not be completed safely." }, { status: 500 });
  }
}
