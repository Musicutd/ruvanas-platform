import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import PodcastWorkspace from "./PodcastWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Podcasts | Ruvanas" };

export default async function PodcastsPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context?.membership) redirect("/dashboard");
  if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) redirect("/dashboard/account");
  return <PodcastWorkspace />;
}
