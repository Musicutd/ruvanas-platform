import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { canRedeemComplimentaryAccess } from "@/lib/complimentary-access.mjs";
import ComplimentaryAccessClient from "./ComplimentaryAccessClient";

export const dynamic = "force-dynamic";

export default async function ComplimentaryAccessPage() {
  const context = await getActiveOrganisationContext({ subscription: true });
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  const subscription = context.membership.organisation.subscription;
  return <ComplimentaryAccessClient
    organisationName={context.membership.organisation.name}
    canRedeem={canRedeemComplimentaryAccess(context.membership.role)}
    access={subscription?.complimentaryAccessActive ? {
      active: true,
      planName: subscription.complimentaryPlanName,
      activatedAt: subscription.complimentaryAccessActivatedAt?.toISOString() || null,
      stationLimit: subscription.complimentaryStationLimit,
      listenerLimit: subscription.complimentaryListenerLimit,
      storageLimitGb: subscription.complimentaryStorageLimitGb,
      maxBitrateKbps: subscription.complimentaryMaxBitrateKbps,
      schoolRadioEnabled: subscription.complimentarySchoolRadioEnabled,
      retailMediaEnabled: subscription.complimentaryRetailMediaEnabled,
      digitalSignageEnabled: subscription.complimentaryDigitalSignageEnabled
    } : { active: false }}
  />;
}
