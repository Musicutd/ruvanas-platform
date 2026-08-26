import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import GroupLocationsForm from "./GroupLocationsForm";

export default async function LocationGroupPage({ params }) {
  const group = await prisma.locationGroup.findUnique({
    where: { id: params.groupId },
    include: { locations: { select: { locationId: true } } }
  });

  if (!group) {
    notFound();
  }

  const selectedIds = new Set(group.locations.map((membership) => membership.locationId));
  const locations = await prisma.location.findMany({
    where: { organisationId: group.organisationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true }
  });

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Link href="/admin/location-groups">← Location groups</Link>
      <h1 style={{ marginBottom: 8 }}>{group.name}</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>{group.description || "Choose the locations that belong to this group."}</p>
      <section style={{ marginTop: 24, padding: 20, border: "1px solid #cbd5e1", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>Locations</h2>
        <GroupLocationsForm groupId={group.id} locations={locations.map((location) => ({ ...location, selected: selectedIds.has(location.id) }))} />
      </section>
    </div>
  );
}

