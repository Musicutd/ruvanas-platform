import { z } from "zod";
import { catalogueTierSchema, catalogueTierStorage, MAX_CATALOGUE_TIER_UPDATES } from "./catalogue-audience.mjs";
import { catalogueLevelAllows } from "./autodj-genre-entitlements.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export { MAX_CATALOGUE_TIER_UPDATES };
const inputSchema = z.object({
  trackIds: z.array(z.string().cuid()).min(1).max(MAX_CATALOGUE_TIER_UPDATES),
  minimumCatalogueLevel: catalogueTierSchema,
  rightsConfirmed: z.literal(true)
}).strict();

export class CatalogueBulkAudienceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function parseCatalogueBulkAudience(input) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose 1–500 catalogue tracks, a tier and confirm that their licences cover the new tier." };
  if (new Set(parsed.data.trackIds).size !== parsed.data.trackIds.length) return { ok: false, error: "A catalogue track cannot be selected twice." };
  return { ok: true, data: parsed.data };
}

// This operation changes only the selected tracks' tier. The audience's
// product uses, territories, licence dates and rights review remain intact.
export async function updateCatalogueTiers(db, actor, input) {
  if (actor?.role !== "SUPER_ADMIN" || !actor.id) throw new CatalogueBulkAudienceError("Only a Ruvanas Super Admin can change catalogue access.", 403);
  const parsed = parseCatalogueBulkAudience(input);
  if (!parsed.ok) throw new CatalogueBulkAudienceError(parsed.error);
  const { trackIds, minimumCatalogueLevel } = parsed.data;
  const tierData = catalogueTierStorage(minimumCatalogueLevel);
  return runSerializableTransaction(db, async tx => {
    const where = {
      id: { in: trackIds }, status: { not: "ARCHIVED" },
      mediaAsset: { libraryType: "RUVANAS_CATALOGUE", organisationId: null, mediaType: "MUSIC", status: { notIn: ["ARCHIVED", "DELETED"] } }
    };
    const tracks = await tx.track.findMany({ where, select: {
      id: true, minimumCatalogueLevel: true, catalogueAllTiers: true, catalogueProvider: true,
      distributorItems: { select: { minimumCatalogueLevel: true } }
    } });
    if (tracks.length !== trackIds.length) throw new CatalogueBulkAudienceError("One or more selected catalogue tracks are unavailable. Refresh the catalogue and select them again.", 409);
    if (tracks.some(track => track.catalogueProvider && (!track.distributorItems.length || track.distributorItems.some(item => !catalogueLevelAllows(tierData.minimumCatalogueLevel, item.minimumCatalogueLevel))))) {
      throw new CatalogueBulkAudienceError("The selected tier is broader than a track's provider-approved scope. Review that track's licence separately; nothing has changed.");
    }
    const changed = tracks.filter(track => track.minimumCatalogueLevel !== tierData.minimumCatalogueLevel || (track.catalogueAllTiers === true) !== tierData.catalogueAllTiers);
    if (changed.length) {
      const result = await tx.track.updateMany({ where: { ...where, id: { in: changed.map(track => track.id) } }, data: tierData });
      if (result.count !== changed.length) throw new CatalogueBulkAudienceError("The catalogue changed during this update. Refresh and try again; nothing has changed.", 409);
      await tx.auditLog.create({ data: {
        actorUserId: actor.id, action: "CATALOGUE_TRACK_TIERS_BULK_UPDATED", entityType: "Track",
        details: { before: changed.map(({ id, minimumCatalogueLevel: previous, catalogueAllTiers }) => ({ id, minimumCatalogueLevel: previous, catalogueAllTiers: catalogueAllTiers === true })), after: tierData, selectedCount: trackIds.length, changedCount: changed.length }
      } });
    }
    return { selectedCount: trackIds.length, updatedCount: changed.length, unchangedCount: trackIds.length - changed.length, minimumCatalogueLevel };
  });
}
