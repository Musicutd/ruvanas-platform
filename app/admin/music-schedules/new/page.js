import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import NewMusicScheduleForm from "./NewMusicScheduleForm";

export default async function NewMusicSchedulePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/channels");
  const [organisations, locations, modes] = await Promise.all([
    prisma.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ select: { id: true, organisationId: true, name: true, timezone: true, zones: { select: { id: true, name: true }, orderBy: { name: "asc" } } }, orderBy: [{ name: "asc" }] }),
    prisma.musicMode.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, organisationId: true, name: true, status: true }, orderBy: [{ name: "asc" }] })
  ]);
  return <NewMusicScheduleForm organisations={organisations} locations={locations} modes={modes} />;
}
