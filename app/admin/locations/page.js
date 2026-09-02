import Link from "next/link";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/app/components/PageHeader";
import EmptyState from "@/app/components/EmptyState";
import { interfaceMessages } from "@/lib/interface-guidance.mjs";

export default async function AdminLocationsPage() {
  const locations = await prisma.location.findMany({
    include: {
      organisation: true,
      brand: true,
      zones: true,
      groupMemberships: {
        include: { locationGroup: true }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" }}>
      <PageHeader
        eyebrow="Customer setup"
        title={interfaceMessages.locations.title}
        description="Manage physical shops, venues and branches together with their listening areas, opening hours and channel assignments."
      >
        <Link
          href="/admin/locations/new"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 8,
            background: "#f4b942",
            color: "#101827",
            fontWeight: 800,
            textDecoration: "none"
          }}
        >
          Add location
        </Link>
      </PageHeader>

      {locations.length === 0 ? (
        <EmptyState
          title={interfaceMessages.locations.emptyTitle}
          description={interfaceMessages.locations.emptyDescription}
          actionHref="/admin/locations/new"
          actionLabel="Add location"
        />
      ) : (
        <div style={{ overflowX: "auto", marginTop: 24 }}>
          <table
            style={{
              width: "100%",
              minWidth: 860,
              borderCollapse: "collapse"
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #444"
                }}
              >
                <th scope="col" style={{ padding: 8 }}>Location</th>
                <th scope="col" style={{ padding: 8 }}>Organisation</th>
                <th scope="col" style={{ padding: 8 }}>Brand</th>
                <th scope="col" style={{ padding: 8 }}>Timezone</th>
                <th scope="col" style={{ padding: 8 }}>Zones</th>
                <th scope="col" style={{ padding: 8 }}>Groups</th>
                <th scope="col" style={{ padding: 8 }}>Status</th>
                <th scope="col" style={{ padding: 8 }}>Created</th>
                <th scope="col" style={{ padding: 8 }}>Action</th>
              </tr>
            </thead>

            <tbody>
              {locations.map((location) => (
                <tr
                  key={location.id}
                  style={{ borderBottom: "1px solid #2a2a2a" }}
                >
                  <td style={{ padding: 8 }}>
                    <div style={{ fontWeight: 700 }}>{location.name}</div>

                    {location.city || location.countryCode ? (
                      <div style={{ fontSize: 13, opacity: 0.7 }}>
                        {[location.city, location.countryCode]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    ) : null}
                  </td>

                  <td style={{ padding: 8 }}>
                    {location.organisation.name}
                  </td>

                  <td style={{ padding: 8 }}>
                    {location.brand?.name ?? "—"}
                  </td>

                  <td style={{ padding: 8 }}>{location.timezone}</td>

                  <td style={{ padding: 8 }}>{location.zones.length}</td>

                  <td style={{ padding: 8 }}>
                    {location.groupMemberships.length > 0
                      ? location.groupMemberships.map((membership) => membership.locationGroup.name).join(", ")
                      : "—"}
                  </td>

                  <td style={{ padding: 8 }}>{location.status}</td>

                  <td style={{ padding: 8 }}>
                    {new Date(location.createdAt).toLocaleDateString()}
                  </td>

                  <td style={{ padding: 8 }}>
                    <Link
                      href={`/admin/locations/${location.id}`}
                      style={{
                        display: "inline-block",
                        padding: "8px 11px",
                        border: "1px solid #f4b942",
                        borderRadius: 7,
                        color: "#f4b942",
                        fontSize: 14,
                        fontWeight: 800,
                        textDecoration: "none"
                      }}
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Link href="/admin/stations">← Back to stations</Link>
      </div>
    </main>
  );
}

