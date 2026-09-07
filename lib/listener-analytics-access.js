import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { ORGANISATION_MANAGER_ROLES, ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";

export async function requireListenerAnalyticsAccess({ exportReport = false } = {}) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  const role = context.membership?.role;
  if (!context.membership || !ORGANISATION_MEMBER_ROLES.includes(role)) {
    return { ok: false, status: 403, error: "Choose an organisation you belong to before viewing listener analytics." };
  }
  if (exportReport && !ORGANISATION_MANAGER_ROLES.includes(role)) {
    return { ok: false, status: 403, error: "Only organisation owners and managers can export listener analytics." };
  }
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!entitlements.onlineRadioEnabled) {
    return { ok: false, status: 403, error: "Listener analytics are available with Online Radio." };
  }
  return { ok: true, user: context.user, membership: context.membership, organisation: context.membership.organisation };
}
