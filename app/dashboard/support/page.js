import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SubscriberSupportClient from "./SubscriberSupportClient";

export const dynamic = "force-dynamic";

export default async function SubscriberSupportPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  return (
    <SubscriberSupportClient
      organisationName={context.membership.organisation.name}
      membershipRole={context.membership.role}
    />
  );
}

