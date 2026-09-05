import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import ListenerAnalyticsClient from "./ListenerAnalyticsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listener analytics | Ruvanas" };

export default async function ListenerAnalyticsPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <ListenerAnalyticsClient
    organisationName={context.membership.organisation.name}
    canExport={ORGANISATION_MANAGER_ROLES.includes(context.membership.role)}
  />;
}
