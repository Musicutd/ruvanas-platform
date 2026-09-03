import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import TeamWorkspace from "./TeamWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organisation & team | Ruvanas" };

export default async function SubscriberTeamPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");
  return <TeamWorkspace />;
}
