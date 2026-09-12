import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { redirect } from "next/navigation";
import { requireListenerAnalyticsAccess } from "@/lib/listener-analytics-access";
import ListenerAnalyticsClient from "./ListenerAnalyticsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listener analytics | Ruvanas" };

export default async function ListenerAnalyticsPage() {
  const access = await requireListenerAnalyticsAccess();
  if (!access.ok) redirect("/dashboard/account?reason=product-not-included");
  return <ListenerAnalyticsClient
    organisationName={access.organisation.name}
    canExport={ORGANISATION_MANAGER_ROLES.includes(access.membership.role)}
  />;
}
