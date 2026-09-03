import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { buildSubscriberNavigation } from "@/lib/user-experience-navigation.mjs";
import SubscriberPortalShell from "./SubscriberPortalShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }) {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { select: { id: true, status: true }, orderBy: { createdAt: "asc" } }
  });

  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  const firstStation = organisation.stations.find((station) => station.status === "ACTIVE")
    || organisation.stations[0]
    || null;
  const navigation = buildSubscriberNavigation({
    entitlements,
    firstStationId: firstStation?.id || null
  });

  return (
    <SubscriberPortalShell
      navigation={navigation}
      organisationName={organisation.name}
      userName={context.user.name || context.user.email}
      membershipRole={context.membership.role}
    >
      {children}
    </SubscriberPortalShell>
  );
}
