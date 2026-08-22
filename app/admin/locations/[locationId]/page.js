import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import AddZoneForm from "./AddZoneForm";
import AssignChannelForm from "./AssignChannelForm";

function formatAddress(location) {
  return [
    location.addressLine1,
    location.addressLine2,
    [location.postalCode, location.city].filter(Boolean).join(" "),
    location.region,
    location.countryCode
  ].filter(Boolean);
}

export default async function AdminLocationDetailPage({ params }) {
  const location = await prisma.location.findUnique({
    where: {
      id: params.locationId
    },
    include: {
      organisation: true,
      brand: true,
      zones: {
        include: {
          channelAssignments: {
            where: {
              activeTo: null
            },
            include: {
              channel: {
                include: {
                  station: {
                    include: {
                      streamConfig: true
                    }
                  }
                }
              }
            },
            orderBy: {
              activeFrom: "desc"
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!location) {
    notFound();
  }

  const channels = await prisma.channel.findMany({
    where: {
      organisationId: location.organisationId,
      status: {
        not: "ARCHIVED"
      }
    },
    include: {
      station: {
        include: {
          streamConfig: true
        }
      }
    },
    orderBy: {
      name: "asc"
    }
  });

  const addressLines = formatAddress(location);

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: "0 16px" }}>
      <Link
        href="/admin/locations"
        style={{
          display: "inline-block",
          marginBottom: 20,
          color: "#f4b942",
          fontWeight: 700,
          textDecoration: "none"
        }}
      >
        ← Back to retail locations
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 28
        }}
      >
        <div>
          <p
            style={{
              margin: "0 0 8px",
              color: "#f4b942",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: "uppercase"
            }}
          >
            Retail location
          </p>

          <h1 style={{ margin: 0, fontSize: 30 }}>{location.name}</h1>

          <p style={{ margin: "10px 0 0", color: "#9fb3c8" }}>
            {location.organisation.name}
            {location.brand ? ` · ${location.brand.name}` : ""}
          </p>
        </div>

        <div
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid #42526b",
            color: "#d8e0ec",
            fontSize: 13,
            fontWeight: 800
          }}
        >
          {location.status}
        </div>
      </div>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Location details</h2>

        <div style={styles.detailGrid}>
          <div>
            <div style={styles.label}>Timezone</div>
            <div style={styles.value}>{location.timezone}</div>
          </div>

          <div>
            <div style={styles.label}>Location slug</div>
            <div style={styles.value}>{location.slug}</div>
          </div>

          <div>
            <div style={styles.label}>Address</div>
            <div style={styles.value}>
              {addressLines.length > 0 ? (
                addressLines.map((line) => <div key={line}>{line}</div>)
              ) : (
                <span style={{ opacity: 0.7 }}>No address entered</span>
              )}
            </div>
          </div>

          <div>
            <div style={styles.label}>Created</div>
            <div style={styles.value}>
              {new Date(location.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      </section>

      <section style={styles.section}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 16
          }}
        >
          <div>
            <h2 style={{ ...styles.sectionTitle, marginBottom: 6 }}>
              Audio zones
            </h2>

            <p style={{ margin: 0, color: "#9fb3c8", fontSize: 14 }}>
              Assign a friendly Ruvanas Channel to each audio zone. One channel
              can be assigned to more than one zone.
            </p>
          </div>

          <AddZoneForm locationId={location.id} />
        </div>

        {location.zones.length === 0 ? (
          <p style={{ margin: 0, color: "#9fb3c8" }}>
            No zones have been created for this location.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 850,
                borderCollapse: "collapse"
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    borderBottom: "1px solid #42526b"
                  }}
                >
                  <th style={{ padding: 8 }}>Zone</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8 }}>Assigned channel</th>
                  <th style={{ padding: 8 }}>Stream status</th>
                  <th style={{ padding: 8 }}>Created</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>

              <tbody>
                {location.zones.map((zone) => {
                  const activeAssignment = zone.channelAssignments[0];
                  const channel = activeAssignment?.channel;
                  const streamConfigured = Boolean(
                    channel?.station?.streamConfig?.streamUrl
                  );

                  return (
                    <tr
                      key={zone.id}
                      style={{ borderBottom: "1px solid #2b3a54" }}
                    >
                      <td style={{ padding: 8, fontWeight: 700 }}>
                        {zone.name}
                      </td>

                      <td style={{ padding: 8 }}>{zone.status}</td>

                      <td style={{ padding: 8 }}>
                        {channel ? channel.name : "Not assigned"}
                      </td>

                      <td style={{ padding: 8 }}>
                        {channel
                          ? streamConfigured
                            ? "Stream configured"
                            : "Stream not configured"
                          : "No channel assigned"}
                      </td>

                      <td style={{ padding: 8 }}>
                        {new Date(zone.createdAt).toLocaleDateString()}
                      </td>

                      <td style={{ padding: 8 }}>
                        <AssignChannelForm
                          locationId={location.id}
                          zoneId={zone.id}
                          channels={channels}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  section: {
    marginBottom: 24,
    padding: 22,
    border: "1px solid #2b3a54",
    borderRadius: 12,
    background: "#182235"
  },
  sectionTitle: {
    margin: "0 0 18px",
    color: "#f4b942",
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 20
  },
  label: {
    marginBottom: 6,
    color: "#9fb3c8",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  value: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 1.55
  }
};
