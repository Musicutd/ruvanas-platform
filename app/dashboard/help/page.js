import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { subscriberHelpOverview } from "@/lib/subscriber-help-centre.mjs";
import HelpCentreClient from "./HelpCentreClient";

export const dynamic = "force-dynamic";

export default async function SubscriberHelpPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  const help = subscriberHelpOverview(context.membership.role, resolveEntitlements(context.membership.organisation.subscription));
  return <HelpCentreClient organisationName={context.membership.organisation.name} help={help} />;
}
