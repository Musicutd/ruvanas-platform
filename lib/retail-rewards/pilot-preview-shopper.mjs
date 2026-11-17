import { rewardIdSchema } from "./contracts.mjs";
import { pilotPreviewOrganisationIds } from "./pilot-preview-policy.mjs";

// Only the existing immutable pilot-origin enrollment admits a shopper to the
// preview bridge. A business/preview cookie, email or supplied organisation is
// never evidence of shopper identity. Call inside the authentication transaction
// as well as session reads so removing an allowlisted organisation takes effect.
export async function pilotPreviewShopperAllowed({ db, env = {}, shopperId } = {}) {
  try {
    const scope = pilotPreviewOrganisationIds(env);
    if (scope === null) return true;
    if (!scope.length || !rewardIdSchema.safeParse(shopperId).success) return false;
    const row = await db.rewardPilotShopperEnrollment.findUnique({ where: { shopperId },
      select: { shopperId: true, organisationId: true } });
    const current = pilotPreviewOrganisationIds(env);
    return Array.isArray(current) && row?.shopperId === shopperId &&
      rewardIdSchema.safeParse(row.organisationId).success && current.includes(row.organisationId);
  } catch { return false; }
}
