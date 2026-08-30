import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import NotificationsClient from "./NotificationsClient";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");

  return <NotificationsClient organisationName={context.membership.organisation.name} />;
}
