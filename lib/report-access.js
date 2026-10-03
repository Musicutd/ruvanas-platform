import { getActiveOrganisationContext } from "@/lib/auth";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

export async function requireActiveReportOrganisation({ excludeCorrections = false } = {}) {
  const context = await getActiveOrganisationContext(excludeCorrections
    ? { subscription: { include: { plan: true, billingContract: true } } }
    : {});
  if (!context) {
    return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  }
  if (!context.membership || !ORGANISATION_MEMBER_ROLES.includes(context.membership.role)) {
    return { ok: false, status: 403, error: "Choose an organisation you belong to before viewing reports." };
  }
  if (excludeCorrections) {
    const entitlements = resolveEntitlements(context.membership.organisation.subscription);
    if (!entitlements.serviceEnabled || entitlements.planProductFamily === "CORRECTIONS") {
      return { ok: false, status: 403, error: "General campaign reports are unavailable for this service." };
    }
  }
  return {
    ok: true,
    user: context.user,
    membership: context.membership,
    organisation: context.membership.organisation
  };
}

