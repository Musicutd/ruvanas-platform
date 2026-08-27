import { getActiveOrganisationContext } from "@/lib/auth";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";

export async function requireActiveReportOrganisation() {
  const context = await getActiveOrganisationContext();
  if (!context) {
    return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  }
  if (!context.membership || !ORGANISATION_MEMBER_ROLES.includes(context.membership.role)) {
    return { ok: false, status: 403, error: "Choose an organisation you belong to before viewing reports." };
  }
  return {
    ok: true,
    user: context.user,
    membership: context.membership,
    organisation: context.membership.organisation
  };
}

