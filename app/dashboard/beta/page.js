import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import BetaFeedbackWorkspace from "./BetaFeedbackWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Beta feedback | Ruvanas" };

export default async function BetaFeedbackPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  return <BetaFeedbackWorkspace organisationName={context.membership.organisation.name} />;
}
