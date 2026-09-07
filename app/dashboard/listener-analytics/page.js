import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ListenerAnalyticsClient from "./ListenerAnalyticsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listener analytics | Ruvanas" };

export default async function ListenerAnalyticsPage() {
  const { context } = await requireSubscriberProduct("ONLINE");
  return <ListenerAnalyticsClient
    organisationName={context.membership.organisation.name}
    canExport={ORGANISATION_MANAGER_ROLES.includes(context.membership.role)}
  />;
}
