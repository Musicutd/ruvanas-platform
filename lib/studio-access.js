import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { isOrganisationRoleAllowed } from "@/lib/permissions.mjs";

export async function requireActiveStudio(allowedRoles) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true } } });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  if (!context.membership) return { ok: false, status: 403, error: "Choose an organisation before opening Ruvanas Studio." };
  if (!isOrganisationRoleAllowed(context.membership.role, allowedRoles)) {
    return { ok: false, status: 403, error: "You do not have permission to access Ruvanas Studio." };
  }
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.serviceEnabled) return { ok: false, status: 403, error: "Ruvanas Studio is unavailable while this subscription is inactive." };
  return { ok: true, user: context.user, membership: context.membership, organisation, entitlements };
}

