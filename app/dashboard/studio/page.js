import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import StudioClient from "./StudioClient";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) redirect("/dashboard");
  return <StudioClient />;
}


