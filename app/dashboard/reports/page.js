import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CampaignProofReportClient from "./CampaignProofReportClient";
import CombinedDeliveryReportClient from "./CombinedDeliveryReportClient";

export const dynamic = "force-dynamic";

export default async function CampaignProofReportsPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const retailMediaOrders = await prisma.retailMediaOrder.findMany({
    where: { organisationId: context.membership.organisation.id, status: { in: ["APPROVED", "FULFILLED"] } },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" }
  });
  return <><CampaignProofReportClient organisationName={context.membership.organisation.name} /><div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 20px 72px" }}><CombinedDeliveryReportClient retailMediaOrders={retailMediaOrders} /></div></>;
}

