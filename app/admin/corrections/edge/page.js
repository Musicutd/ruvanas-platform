import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import EdgeFleet from "./EdgeFleet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside Secure Edge | Ruvanas Super Admin" };

export default async function AdminCorrectionsEdgePage() {
  const user = await getAdminUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") notFound();
  const facilities = await prisma.correctionsFacility.findMany({
    where: { location: { status: "ACTIVE" } },
    select: { locationId: true, location: { select: { name: true, organisationId: true,
      organisation: { select: { name: true } } } } },
    orderBy: { location: { name: "asc" } }, take: 500
  });
  return <EdgeFleet facilities={facilities.map((item) => ({ id: item.locationId,
    name: item.location.name, organisationId: item.location.organisationId,
    organisationName: item.location.organisation.name }))} />;
}
