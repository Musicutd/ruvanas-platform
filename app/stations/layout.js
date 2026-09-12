import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { hasSubscriberProduct } from "@/lib/product-access.mjs";

export default async function RadioStationManagementLayout({ children }) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/register");
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!["ONLINE", "HEALTH", "FAITH"].some((product) => hasSubscriberProduct(entitlements, product))) {
    redirect("/dashboard/account?product=radio&reason=not-included");
  }
  return children;
}
