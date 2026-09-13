import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { guideIdsForEntitlements } from "@/lib/how-ruvanas-works.mjs";
import HowItWorksClient from "./HowItWorksClient";

export const dynamic = "force-dynamic";

export default async function HowItWorksPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);

  return (
    <HowItWorksClient
      organisationName={context.membership.organisation.name}
      membershipRole={context.membership.role}
      visibleProductIds={guideIdsForEntitlements(entitlements)}
    />
  );
}
