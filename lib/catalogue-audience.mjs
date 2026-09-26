import { z } from "zod";
import { parseCatalogueTerritories } from "./catalogue-territories.mjs";

export const CATALOGUE_PILLARS = Object.freeze([
  { use: "RETAIL_RADIO", label: "Retail Radio" },
  { use: "SCHOOL_RADIO", label: "School Radio" },
  { use: "ONLINE_RADIO", label: "Online Radio" },
  { use: "HEALTH_RADIO", label: "Health Radio" },
  { use: "FAITH_RADIO", label: "Faith Radio" },
  { use: "ORGANISATIONS_RADIO", label: "Ruvanas Organisations" },
  { use: "CORRECTIONS_RADIO", label: "Ruvanas Inside" }
]);

export const CATALOGUE_TIERS = Object.freeze([
  { level: "FOCUSED", label: "Tier 3 and above" },
  { level: "PROFESSIONAL", label: "Tier 4 and above" },
  { level: "PREMIUM", label: "Tier 5 only" }
]);

export const catalogueUseSchema = z.enum(CATALOGUE_PILLARS.map((pillar) => pillar.use));
export const catalogueTierSchema = z.enum(CATALOGUE_TIERS.map((tier) => tier.level));

export function parseCatalogueAudience(input) {
  const parsed = z.object({
    minimumCatalogueLevel: catalogueTierSchema,
    permittedUses: z.array(catalogueUseSchema).min(1, "Choose at least one pillar for this catalogue music."),
    permittedTerritories: z.union([z.string(), z.array(z.string())])
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Choose a tier and at least one pillar." };
  const territories = parseCatalogueTerritories(parsed.data.permittedTerritories);
  if (!territories.ok) return territories;
  return { ok: true, data: { ...parsed.data, permittedTerritories: territories.codes.join(","), permittedUses: [...new Set(parsed.data.permittedUses)] } };
}

// Older catalogue records pre-date the Super Admin tier control. They must not
// bypass it: until reviewed, treat them as Tier 3, never as an all-tier grant.
export function effectiveCatalogueLevel(level) {
  return catalogueTierSchema.safeParse(level).success ? level : "FOCUSED";
}
