import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import StudioHubClient from "./StudioHubClient";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!entitlements.serviceEnabled) redirect("/dashboard");
  return <StudioHubClient entitlements={{ planName: entitlements.planName, planProductFamily: entitlements.planProductFamily, studioLevel: entitlements.studioLevel, studioProEnabled: entitlements.studioProEnabled }} />;
}



