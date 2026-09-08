import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { canManageSubscriberLocations, subscriberLocationAllowance } from "@/lib/subscriber-locations.mjs";
import LocationsClient from "./LocationsClient";

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
  const returnTo = searchParams?.returnTo === "signage" ? "signage" : searchParams?.returnTo === "players" ? "players" : null;
  return <LocationsClient
    initialLocations={organisation.locations}
    brands={organisation.brands}
    allowance={allowance}
    canManage={allowance.enabled && canManageSubscriberLocations(context.membership.role)}
    returnTo={returnTo}
  />;
}
