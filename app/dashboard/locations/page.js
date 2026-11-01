import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { canManageSubscriberLocations, subscriberLocationAllowance } from "@/lib/subscriber-locations.mjs";
import LocationsClient from "./LocationsClient";
import { subscriberWorkflowRequestAllowed } from "@/lib/private-preview-subscriber-testing.mjs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Locations & Zones | Ruvanas" };

export default async function SubscriberLocationsPage({ searchParams }) {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    brands: { orderBy: { name: "asc" }, select: { id: true, name: true } },
    locations: {
      where: { status: { not: "CLOSED" } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, timezone: true, city: true, countryCode: true, status: true, zones: { where: { status: { not: "OFFLINE" } }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, status: true } } }
    }
  });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const organisation = context.membership.organisation;
  const allowance = subscriberLocationAllowance(organisation.subscription);
  const setupAccessEnabled = subscriberWorkflowRequestAllowed(context, { pathname: "/api/locations", method: "POST" });
  const query = await searchParams;
  const returnTo = query?.returnTo === "signage" ? "signage" : query?.returnTo === "players" ? "players" : null;
  return <LocationsClient
    initialLocations={organisation.locations}
    brands={organisation.brands}
    allowance={allowance}
    canManage={setupAccessEnabled && allowance.enabled && canManageSubscriberLocations(context.membership.role)}
    setupAccessEnabled={setupAccessEnabled}
    returnTo={returnTo}
  />;
}
