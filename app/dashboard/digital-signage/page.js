import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import DigitalSignageConsole from "@/app/admin/digital-signage/DigitalSignageConsole";

export const dynamic = "force-dynamic";

export default async function SubscriberDigitalSignagePage() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    locations: { select: { id: true, name: true, zones: { select: { id: true, name: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }
  });
  if (!context) redirect("/login");
  if (!context.membership || !ORGANISATION_CONTENT_ROLES.includes(context.membership.role)) redirect("/dashboard");
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.digitalSignageEnabled) redirect("/dashboard");
  return <DigitalSignageConsole organisations={[{ id: organisation.id, name: organisation.name, locations: organisation.locations, digitalSignageEnabled: true }]} showOrganisationSelector={false} />;
}
