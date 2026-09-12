import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { isOrganisationRoleAllowed } from "@/lib/permissions.mjs";

const PODCAST_ACCESS = Object.freeze({
  ONLINE: { entitlement: "onlineRadioEnabled", label: "Online Radio" },
  SCHOOL: { entitlement: "schoolRadioEnabled", label: "School Radio" },
  HEALTH: { entitlement: "healthRadioEnabled", label: "Health Radio" },
  FAITH: { entitlement: "faithRadioEnabled", label: "Faith Radio" },
  ORGANISATIONS: { entitlement: "organisationsEnabled", label: "Ruvanas Organisations" }
});

export async function requireActivePodcast(allowedRoles, product = "ONLINE") {
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
  const access = PODCAST_ACCESS[product];
  if (!access) return { ok: false, status: 400, error: "Choose a supported podcast product." };
  if (!entitlements[access.entitlement]) {
    return { ok: false, status: 403, error: `Podcasts are unavailable while this ${access.label} service is inactive.` };
  }
  return { ok: true, user: context.user, membership: context.membership, organisation, entitlements, product };
}
