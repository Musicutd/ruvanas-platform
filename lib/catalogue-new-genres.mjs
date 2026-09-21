const normalizedName = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const baseSlug = (value) => normalizedName(value).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "genre";

export async function resolveNewCatalogueGenres(tx, names) {
  const ids = [];
  const createdNames = [];
  for (const name of names) {
    const normalizedKey = normalizedName(name);
    let genre = await tx.mediaGenre.findFirst({
      where: { OR: [{ normalizedKey }, { name: { equals: name, mode: "insensitive" } }] }
    });
    if (!genre) {
      const base = baseSlug(name);
      let slug = base;
      for (let suffix = 2; await tx.mediaGenre.findUnique({ where: { slug } }); suffix += 1) {
        if (suffix > 100) throw new Error("Could not allocate a new catalogue genre name.");
        slug = `${base}-${suffix}`.slice(0, 100);
      }
      genre = await tx.mediaGenre.create({ data: {
        name,
        slug,
        normalizedKey,
        active: true,
        minimumCatalogueLevel: "PREMIUM",
        autoCreated: true,
        providerReviewStatus: "APPROVED"
      } });
      createdNames.push(genre.name);
    }
    if (!genre.active || genre.providerReviewStatus !== "APPROVED") {
      throw Object.assign(new Error(`The genre “${name}” is not available for catalogue tracks.`), { code: "CATALOGUE_GENRE_UNAVAILABLE" });
    }
    ids.push(genre.id);
  }
  return { ids, createdNames };
}
