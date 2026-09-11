import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { CANONICAL_AUTODJ_GENRES, normaliseGenreCode } from "@/lib/autodj-genre-entitlements.mjs";

const schema = z.object({ minimumCatalogueLevel: z.enum(["FOCUSED", "PROFESSIONAL", "PREMIUM"]) });

export async function PATCH(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can change catalogue genre tiers." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid catalogue tier." }, { status: 400 });
  const current = await prisma.mediaGenre.findUnique({ where: { id: params.genreId }, select: { id: true, name: true, slug: true } });
  if (!current) return NextResponse.json({ error: "Genre not found." }, { status: 404 });
  const fixed = CANONICAL_AUTODJ_GENRES.find((item) => item.code === normaliseGenreCode(current.slug || current.name));
  if (fixed && parsed.data.minimumCatalogueLevel !== fixed.minimumLevel) {
    return NextResponse.json({ error: `${fixed.label} is fixed at the ${fixed.minimumLevel.toLowerCase()} entitlement level.` }, { status: 400 });
  }
  const genre = await prisma.mediaGenre.update({ where: { id: current.id }, data: parsed.data, select: { id: true, name: true, slug: true, minimumCatalogueLevel: true } });
  if (!genre) return NextResponse.json({ error: "Genre not found." }, { status: 404 });
  await prisma.auditLog.create({ data: { actorUserId: access.user.id, action: "CATALOGUE_GENRE_TIER_UPDATED", entityType: "MediaGenre", entityId: genre.id, details: { minimumCatalogueLevel: genre.minimumCatalogueLevel } } });
  return NextResponse.json({ ok: true, genre });
}
