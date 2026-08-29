import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import RetailMediaConsole from "@/app/admin/retail-media/RetailMediaConsole";

export const dynamic = "force-dynamic";

export default async function SubscriberRetailMediaPage() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    brands: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    locationGroups: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    locations: { select: { id: true, name: true, zones: { select: { id: true, name: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } },
    promoAssets: { where: { status: "ACTIVE" }, select: { id: true, name: true, versions: { where: { status: "APPROVED", mediaAsset: { status: "READY" } }, select: { id: true, version: true }, orderBy: { version: "desc" } } }, orderBy: { name: "asc" } },
    campaigns: { where: { status: "DRAFT", retailMediaOrder: null }, select: { id: true, name: true, promoVersionId: true }, orderBy: { name: "asc" } }
  });
  if (!context) redirect("/login");
  if (!context.membership || !ORGANISATION_CONTENT_ROLES.includes(context.membership.role)) redirect("/dashboard");

  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.retailMediaEnabled) redirect("/dashboard");

  const clientOrganisation = {
    id: organisation.id,
    name: organisation.name,
    retailMediaEnabled: true,
    brands: organisation.brands,
    locationGroups: organisation.locationGroups,
    locations: organisation.locations,
    promoAssets: organisation.promoAssets,
    campaigns: organisation.campaigns
  };
  return <RetailMediaConsole organisations={[clientOrganisation]} canApprove={ORGANISATION_MANAGER_ROLES.includes(context.membership.role)} showOrganisationSelector={false} />;
}
