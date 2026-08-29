import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess } from "@/lib/access-control";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

export async function requireDigitalSignageOrganisation(organisationId, allowedRoles) {
  const access = await requireOrganisationAccess(organisationId, allowedRoles);
  if (!access.ok) return access;

  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    include: { subscription: { include: { plan: true, billingContract: true } } }
  });
  if (!organisation) return { ok: false, status: 404, error: "Organisation not found." };

  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.digitalSignageEnabled) {
    return { ok: false, status: 403, error: "Digital Signage is not enabled for this organisation." };
  }

  return { ...access, organisation, entitlements };
}
