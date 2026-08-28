import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { isOrganisationRoleAllowed } from "@/lib/permissions.mjs";

export async function requireActiveSchoolRadio(allowedRoles) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  if (!context.membership) return { ok: false, status: 403, error: "Choose an organisation before opening School Radio." };
  if (!isOrganisationRoleAllowed(context.membership.role, allowedRoles)) {
    return { ok: false, status: 403, error: "You do not have permission to manage School Radio." };
  }
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.schoolRadioEnabled) {
    return { ok: false, status: 403, error: "School Radio is not enabled for this organisation." };
  }
  return {
    ok: true,
    user: context.user,
    membership: context.membership,
    organisation,
    entitlements
  };
}

