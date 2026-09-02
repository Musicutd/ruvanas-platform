import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { subscriberHelpOverview } from "@/lib/subscriber-help-centre.mjs";
import HelpCentreClient from "./HelpCentreClient";

export const dynamic = "force-dynamic";

export default async function SubscriberHelpPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  const help = subscriberHelpOverview(context.membership.role);
  return <HelpCentreClient organisationName={context.membership.organisation.name} help={help} />;
}
