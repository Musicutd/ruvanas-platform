import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { subscriberProductAccess } from "@/lib/product-access.mjs";

const subscriptionInclude = { subscription: { include: { plan: true, billingContract: true } } };

export async function requireSubscriberProduct(product, organisationInclude = {}) {
  const context = await getActiveOrganisationContext({ ...organisationInclude, ...subscriptionInclude });
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  const access = subscriberProductAccess(entitlements, product);
  if (!access.allowed) {
    const reason = access.reason === "SERVICE_INACTIVE" ? "service-inactive" : "not-included";
    redirect(`/dashboard/account?product=${access.product?.key.toLowerCase() || "unknown"}&reason=${reason}`);
  }

  return { context, entitlements, product: access.product };
}
