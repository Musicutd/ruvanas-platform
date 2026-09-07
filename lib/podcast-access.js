import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { isOrganisationRoleAllowed } from "@/lib/permissions.mjs";

export async function requireActivePodcast(allowedRoles) {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } }
  });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  if (!context.membership) return { ok: false, status: 403, error: "Choose an organisation before opening Podcasts." };
  if (!isOrganisationRoleAllowed(context.membership.role, allowedRoles)) {
    return { ok: false, status: 403, error: "You do not have permission to manage podcasts." };
  }
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.onlineRadioEnabled) {
    return { ok: false, status: 403, error: "Podcasts are unavailable while this Online Radio service is inactive." };
  }
  return { ok: true, user: context.user, membership: context.membership, organisation, entitlements };
}
