import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CampaignBuilder from "./CampaignBuilder";

export default async function CampaignsPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/media");

  const organisations = await prisma.organisation.findMany({
    select: {
      id: true,
      name: true,
      promoAssets: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          versions: {
            where: { status: "APPROVED", mediaAsset: { status: "READY" } },
            select: { id: true, version: true, languageCode: true, durationSeconds: true },
            orderBy: { version: "desc" }
          }
        },
        orderBy: { name: "asc" }
      },
      brands: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      locationGroups: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      locations: {
        where: { status: { not: "CLOSED" } },
        select: {
          id: true,
          name: true,
          timezone: true,
          zones: {
            where: { status: { not: "OFFLINE" } },
            select: { id: true, name: true },
            orderBy: { name: "asc" }
          }
        },
        orderBy: { name: "asc" }
      }
    },
    orderBy: { name: "asc" }
  });

  const query = await searchParams;
  return <CampaignBuilder organisations={organisations} initialSelection={{
    organisationId: String(query?.organisationId || ""),
    promoVersionId: String(query?.promoVersionId || ""),
    name: String(query?.name || "").slice(0, 120),
    effectiveFrom: String(query?.effectiveFrom || ""),
    effectiveTo: String(query?.effectiveTo || "")
  }} />;
}

