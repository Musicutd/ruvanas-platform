import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminLocationsPage() {
  const locations = await prisma.location.findMany({
    include: {
      organisation: true,
      brand: true,
      zones: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap"
        }}
      >
        <div>
          <h1 style={{ marginBottom: 8 }}>Retail Locations</h1>
          <p style={{ margin: 0, opacity: 0.7 }}>
            Manage physical stores, venues, branches, and their in-store audio zones.
          </p>
        </div>

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
      </div>

      {locations.length === 0 ? (
        <div
          style={{
            marginTop: 24,
            padding: 20,
            border: "1px solid #2a2a2a",
            borderRadius: 10
          }}
        >
          <p style={{ marginTop: 0, fontWeight: 700 }}>
            No retail locations yet.
          </p>

          <p style={{ marginBottom: 0, opacity: 0.7 }}>
            Create your first location to represent a physical shop, restaurant,
            office, hotel, or other venue where Ruvanas audio will play.
          </p>
        </div>
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
                <th style={{ padding: 8 }}>Location</th>
                <th style={{ padding: 8 }}>Organisation</th>
                <th style={{ padding: 8 }}>Brand</th>
                <th style={{ padding: 8 }}>Timezone</th>
                <th style={{ padding: 8 }}>Zones</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: 8 }}></th>
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
    </div>
  );
}
