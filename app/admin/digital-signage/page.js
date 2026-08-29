import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DigitalSignageConsole from "./DigitalSignageConsole";

export default async function AdminDigitalSignagePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/media");
  const organisations = await prisma.organisation.findMany({
    select: {
      id: true,
      name: true,
      subscription: { select: { digitalSignageEnabled: true, plan: { select: { digitalSignageEnabled: true } } } },
      locations: { select: { id: true, name: true, zones: { select: { id: true, name: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }
    },
    orderBy: { name: "asc" }
  });
  return <DigitalSignageConsole organisations={organisations.map((organisation) => ({ ...organisation, digitalSignageEnabled: Boolean(organisation.subscription && (organisation.subscription.digitalSignageEnabled ?? organisation.subscription.plan.digitalSignageEnabled)) }))} />;
}
