import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { buildSubscriberNavigation } from "@/lib/user-experience-navigation.mjs";
import { firstListenableOnlineStation, onlineRadioListenHref } from "@/lib/online-radio-listen.mjs";
import { pillarListenHref } from "@/lib/pillar-audio.mjs";
import { enabledSubscriberProducts } from "@/lib/product-access.mjs";
import SubscriberPortalShell from "./SubscriberPortalShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }) {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { select: { id: true, status: true, productFamily: true, streamConfig: { select: { streamUrl: true } } }, orderBy: { createdAt: "asc" } },
    betaParticipations: {
      where: { status: "ACTIVE", programme: { status: "ACTIVE" } },
      select: { id: true },
      take: 1
    }
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
    firstStationId: firstStation?.id || null,
    betaActive: organisation.betaParticipations.length > 0
  });
  const listenStation = entitlements.serviceEnabled && entitlements.onlineRadioEnabled
    ? firstListenableOnlineStation(organisation.stations)
    : null;
  const listenHrefs = Object.fromEntries(enabledSubscriberProducts(entitlements).map((product) => [
    product.key,
    product.key === "ONLINE" && listenStation ? onlineRadioListenHref(listenStation.id) : pillarListenHref(product.key)
  ]));

  return (
    <SubscriberPortalShell
      navigation={navigation}
      organisationName={organisation.name}
      userName={context.user.name || context.user.email}
      membershipRole={context.membership.role}
      listenHrefs={listenHrefs}
    >
      {children}
    </SubscriberPortalShell>
  );
}
