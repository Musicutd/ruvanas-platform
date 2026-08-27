import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import CampaignProofReportClient from "./CampaignProofReportClient";

export const dynamic = "force-dynamic";

export default async function CampaignProofReportsPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <CampaignProofReportClient organisationName={context.membership.organisation.name} />;
}

