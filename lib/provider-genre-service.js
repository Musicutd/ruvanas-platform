import { PROMO_ONLY_PROVIDER, normalizePromoOnlyGenre, promoOnlyGenreSlug } from "./promo-only.mjs";

function displayGenre(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

async function existingGenre(db, normalizedKey, sourceGenre) {
  return db.mediaGenre.findFirst({
    where: { OR: [
      { normalizedKey },
      { name: { equals: sourceGenre, mode: "insensitive" } },
      { slug: promoOnlyGenreSlug(sourceGenre) }
    ] },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }]
  });
}

async function uniqueGenreSlug(db, sourceGenre) {
  const base = promoOnlyGenreSlug(sourceGenre);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const slug = suffix ? `${base}-${suffix + 1}`.slice(0, 100) : base;
    const found = await db.mediaGenre.findUnique({ where: { slug }, select: { id: true } });
    if (!found) return slug;
  }
  throw Object.assign(new Error("A unique provider genre slug could not be allocated."), { code: "PROVIDER_GENRE_SLUG_LIMIT" });
}

export async function syncPromoOnlyGenre(db, sourceValue, config) {
  const sourceGenre = displayGenre(sourceValue);
  const normalizedSourceGenre = normalizePromoOnlyGenre(sourceGenre);
  if (!normalizedSourceGenre) return { genre: null, mapping: null, created: false };
  const mapped = await db.musicProviderGenreMapping.findUnique({
    where: { provider_normalizedSourceGenre: { provider: PROMO_ONLY_PROVIDER, normalizedSourceGenre } },
    include: { catalogGenre: true }
  });
  if (mapped) return { genre: mapped.catalogGenre, mapping: mapped, created: false };

  let genre = await existingGenre(db, normalizedSourceGenre, sourceGenre);
  let created = false;
  if (!genre) {
    if (!config.autoCreateGenres) return { genre: null, mapping: null, created: false };
    const slug = await uniqueGenreSlug(db, sourceGenre);
    const pending = Boolean(config.genreReviewRequired);
    try {
      genre = await db.mediaGenre.create({ data: {
        name: sourceGenre,
        slug,
        normalizedKey: normalizedSourceGenre,
        active: !pending,
        minimumCatalogueLevel: "PREMIUM",
        sourceProvider: PROMO_ONLY_PROVIDER,
        sourceExternalValue: sourceGenre,
        autoCreated: true,
        providerReviewStatus: pending ? "PENDING" : "APPROVED"
      } });
      created = true;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      genre = await existingGenre(db, normalizedSourceGenre, sourceGenre);
      if (!genre) throw error;
    }
  }

  let mapping;
  try {
    mapping = await db.musicProviderGenreMapping.create({ data: {
      provider: PROMO_ONLY_PROVIDER,
      sourceGenre,
      normalizedSourceGenre,
      catalogGenreId: genre.id,
      mappingType: "EXACT",
      reviewStatus: config.genreReviewRequired && created ? "PENDING" : "APPROVED",
      autoCreated: created,
      active: !(config.genreReviewRequired && created)
    } });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    mapping = await db.musicProviderGenreMapping.findUnique({
      where: { provider_normalizedSourceGenre: { provider: PROMO_ONLY_PROVIDER, normalizedSourceGenre } }
    });
  }
  return { genre, mapping, created };
}

export async function updateProviderGenreMapping(db, { mappingId, catalogGenreId, mappingType = "MANUAL", active = true, approve = false }) {
  const mapping = await db.musicProviderGenreMapping.findUnique({ where: { id: mappingId } });
  if (!mapping) throw Object.assign(new Error("The provider genre mapping was not found."), { code: "PROVIDER_GENRE_MAPPING_NOT_FOUND" });
  const genre = await db.mediaGenre.findUnique({ where: { id: catalogGenreId } });
  if (!genre) throw Object.assign(new Error("Choose an existing Ruvanas genre."), { code: "PROVIDER_GENRE_TARGET_NOT_FOUND" });
  return db.musicProviderGenreMapping.update({
    where: { id: mapping.id },
    data: { catalogGenreId: genre.id, mappingType, active, ...(approve ? { reviewStatus: "APPROVED" } : {}) }
  });
}

export async function mergeCatalogueGenres(db, { sourceGenreId, targetGenreId }) {
  if (!sourceGenreId || !targetGenreId || sourceGenreId === targetGenreId) throw new Error("Choose two different catalogue genres to merge.");
  return db.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.mediaGenre.findUnique({ where: { id: sourceGenreId } }),
      tx.mediaGenre.findUnique({ where: { id: targetGenreId } })
    ]);
    if (!source || !target) throw new Error("One of the catalogue genres no longer exists.");
    const assignments = await tx.mediaAssetGenre.findMany({ where: { mediaGenreId: source.id }, select: { mediaAssetId: true, isPrimary: true } });
    if (assignments.length) {
      await tx.mediaAssetGenre.createMany({ data: assignments.map((item) => ({ mediaAssetId: item.mediaAssetId, mediaGenreId: target.id, isPrimary: item.isPrimary })), skipDuplicates: true });
      await tx.mediaAssetGenre.deleteMany({ where: { mediaGenreId: source.id } });
    }
    await tx.musicProviderGenreMapping.updateMany({ where: { catalogGenreId: source.id }, data: { catalogGenreId: target.id, mappingType: "MANUAL" } });
    await tx.musicDistributorTrack.updateMany({ where: { canonicalGenreId: source.id }, data: { canonicalGenreId: target.id } });
    return tx.mediaGenre.update({ where: { id: source.id }, data: { active: false, providerReviewStatus: "APPROVED" } });
  });
}
