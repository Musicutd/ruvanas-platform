import { resolveEntitlements } from "./entitlements.mjs";

export async function catalogueLevelForOrganisation(client, organisationId) {
  const organisation = await client.organisation.findUnique({
    where: { id: organisationId },
    select: { subscription: { include: { plan: true, billingContract: true } } }
  });
  return resolveEntitlements(organisation?.subscription).licensedMusicCatalogueLevel;
}
