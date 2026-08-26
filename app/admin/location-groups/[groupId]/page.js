import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import GroupLocationsForm from "./GroupLocationsForm";
import BulkChannelAssignmentForm from "./BulkChannelAssignmentForm";

export default async function LocationGroupPage({ params }) {
  const group = await prisma.locationGroup.findUnique({
    where: { id: params.groupId },
    include: {
      locations: {
        select: {
          locationId: true,
          location: {
            select: {
              id: true,
              name: true,
              zones: {
                orderBy: { name: "asc" },
                select: {
                  id: true,
                  name: true,
                  channelAssignments: {
                    where: { activeTo: null },
                    orderBy: { activeFrom: "desc" },
                    take: 1,
                    select: {
                      channelId: true,
                      channel: { select: { name: true } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
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
  const channels = await prisma.channel.findMany({
    where: {
      organisationId: group.organisationId,
      status: { not: "ARCHIVED" }
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      station: {
        select: {
          id: true,
          streamConfig: { select: { streamUrl: true } }
        }
      }
    }
  });
  const groupLocations = group.locations.map((membership) => membership.location);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Link href="/admin/location-groups">← Location groups</Link>
      <h1 style={{ marginBottom: 8 }}>{group.name}</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>{group.description || "Choose the locations that belong to this group."}</p>
      <section style={{ marginTop: 24, padding: 20, border: "1px solid #cbd5e1", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>Locations</h2>
        <GroupLocationsForm groupId={group.id} locations={locations.map((location) => ({ ...location, selected: selectedIds.has(location.id) }))} />
      </section>
      <section style={{ marginTop: 24, padding: 20, border: "1px solid #cbd5e1", borderRadius: 10, background: "#f8fafc" }}>
        <h2 style={{ marginTop: 0 }}>Bulk channel assignment</h2>
        <p style={{ color: "#475569", lineHeight: 1.5 }}>
          Preview and apply one channel across every audio zone in this location group. Existing assignments outside this group are not affected.
        </p>
        <BulkChannelAssignmentForm
          groupId={group.id}
          locations={groupLocations}
          channels={channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            station: Boolean(channel.station),
            streamConfigured: Boolean(channel.station?.streamConfig?.streamUrl)
          }))}
        />
      </section>
    </div>
  );
}

