import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import OperationalAnalyticsClient from "./OperationalAnalyticsClient";

export const dynamic = "force-dynamic";

export default async function OperationalAnalyticsPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <OperationalAnalyticsClient
    organisationName={context.membership.organisation.name}
    canExport={ORGANISATION_MANAGER_ROLES.includes(context.membership.role)}
  />;
}
