import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import RetailMediaConsole from "./RetailMediaConsole";

export default async function RetailMediaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/media");
  const organisations = await prisma.organisation.findMany({
    select: {
      id: true,
      name: true,
      subscription: { select: { retailMediaEnabled: true, plan: { select: { retailMediaEnabled: true } } } },
      brands: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      locationGroups: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      locations: { select: { id: true, name: true, zones: { select: { id: true, name: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } },
      promoAssets: { where: { status: "ACTIVE" }, select: { id: true, name: true, versions: { where: { status: "APPROVED", mediaAsset: { status: "READY" } }, select: { id: true, version: true }, orderBy: { version: "desc" } } }, orderBy: { name: "asc" } },
      campaigns: { where: { status: "DRAFT", retailMediaOrder: null }, select: { id: true, name: true, promoVersionId: true }, orderBy: { name: "asc" } }
    },
    orderBy: { name: "asc" }
  });
  return <RetailMediaConsole organisations={organisations.map((organisation) => ({ ...organisation, retailMediaEnabled: Boolean(organisation.subscription && (organisation.subscription.retailMediaEnabled ?? organisation.subscription.plan.retailMediaEnabled)) }))} />;
}
