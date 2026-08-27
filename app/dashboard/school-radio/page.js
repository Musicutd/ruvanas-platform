import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import SchoolRadioClient from "./SchoolRadioClient";

export default async function SchoolRadioPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!entitlements.schoolRadioEnabled) redirect("/dashboard");
  return <SchoolRadioClient />;
}
