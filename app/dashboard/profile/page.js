import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import ProfileSecurityClient from "./ProfileSecurityClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile & security | Ruvanas" };

export default async function SubscriberProfilePage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");
  return <ProfileSecurityClient />;
}
