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
    <main style={styles.page}>
      <Link href="/admin/locations" style={styles.backLink}>
        ← Back to retail locations
      </Link>

      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Retail location</p>
          <h1 style={styles.title}>{location.name}</h1>

          <p style={styles.subtitle}>
            {location.organisation.name}
            {location.brand ? ` · ${location.brand.name}` : ""}
          </p>
        </div>

        <div style={styles.statusBadge}>{location.status}</div>
      </header>

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
                addressLines.map((line, index) => (
                  <div key={`${line}-${index}`}>{line}</div>
                ))
              ) : (
                <span style={styles.muted}>No address entered</span>
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
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={{ ...styles.sectionTitle, marginBottom: 8 }}>
              Audio zones
            </h2>

            <p style={styles.description}>
              Assign a friendly Ruvanas Channel to each audio zone. One channel
              can be assigned to more than one zone.
            </p>
          </div>

          <AddZoneForm locationId={location.id} />
        </div>

        {location.zones.length === 0 ? (
          <p style={styles.muted}>
            No zones have been created for this location.
          </p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Zone</th>
                  <th style={styles.tableHeader}>Status</th>
                  <th style={styles.tableHeader}>Assigned channel</th>
                  <th style={styles.tableHeader}>Stream status</th>
                  <th style={styles.tableHeader}>Created</th>
                  <th style={styles.tableHeader}>Action</th>
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
                    <tr key={zone.id} style={styles.tableRow}>
                      <td style={styles.tableCellStrong}>{zone.name}</td>

                      <td style={styles.tableCell}>
                        <span style={styles.zoneStatus}>{zone.status}</span>
                      </td>

                      <td style={styles.tableCell}>
                        {channel ? (
                          <span style={styles.channelName}>{channel.name}</span>
                        ) : (
                          <span style={styles.muted}>Not assigned</span>
                        )}
                      </td>

                      <td style={styles.tableCell}>
                        {channel ? (
                          <span
                            style={
                              streamConfigured
                                ? styles.streamConfigured
                                : styles.streamMissing
                            }
                          >
                            {streamConfigured
                              ? "Stream configured"
                              : "Stream not configured"}
                          </span>
                        ) : (
                          <span style={styles.muted}>No channel assigned</span>
                        )}
                      </td>

                      <td style={styles.tableCell}>
                        {new Date(zone.createdAt).toLocaleDateString()}
                      </td>

                      <td style={styles.tableCell}>
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
    </main>
  );
}

const styles = {
  page: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "40px 16px 64px",
    color: "#172033",
    background: "#ffffff"
  },
  backLink: {
    display: "inline-block",
    marginBottom: 28,
    color: "#9a6400",
    fontSize: 15,
    fontWeight: 800,
    textDecoration: "none"
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 30
  },
  eyebrow: {
    margin: "0 0 8px",
    color: "#9a6400",
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  title: {
    margin: 0,
    color: "#111827",
    fontSize: 32,
    fontWeight: 900
  },
  subtitle: {
    margin: "10px 0 0",
    color: "#4b5563",
    fontSize: 16,
    fontWeight: 600
  },
  statusBadge: {
    padding: "9px 14px",
    border: "2px solid #64748b",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#1e293b",
    fontSize: 13,
    fontWeight: 900
  },
  section: {
    marginBottom: 24,
    padding: 24,
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)"
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    flexWrap: "wrap",
    marginBottom: 20
  },
  sectionTitle: {
    margin: "0 0 18px",
    color: "#172033",
    fontSize: 17,
    fontWeight: 900,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  description: {
    maxWidth: 720,
    margin: 0,
    color: "#475569",
    fontSize: 15,
    lineHeight: 1.55
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 22
  },
  label: {
    marginBottom: 7,
    color: "#475569",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.7,
    textTransform: "uppercase"
  },
  value: {
    color: "#111827",
    fontSize: 16,
    fontWeight: 650,
    lineHeight: 1.55
  },
  muted: {
    color: "#64748b",
    fontWeight: 600
  },
  tableWrapper: {
    overflowX: "auto",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff"
  },
  table: {
    width: "100%",
    minWidth: 900,
    borderCollapse: "collapse"
  },
  tableHeader: {
    padding: "13px 12px",
    borderBottom: "2px solid #94a3b8",
    background: "#e2e8f0",
    color: "#172033",
    fontSize: 13,
    fontWeight: 900,
    textAlign: "left",
    whiteSpace: "nowrap"
  },
  tableRow: {
    borderBottom: "1px solid #cbd5e1"
  },
  tableCell: {
    padding: "15px 12px",
    color: "#1e293b",
    fontSize: 15,
    fontWeight: 600,
    verticalAlign: "middle"
  },
  tableCellStrong: {
    padding: "15px 12px",
    color: "#111827",
    fontSize: 15,
    fontWeight: 900,
    verticalAlign: "middle"
  },
  zoneStatus: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#dcfce7",
    color: "#166534",
    fontSize: 12,
    fontWeight: 900
  },
  channelName: {
    color: "#111827",
    fontWeight: 900
  },
  streamConfigured: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#dcfce7",
    color: "#166534",
    fontSize: 12,
    fontWeight: 800
  },
  streamMissing: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 12,
    fontWeight: 800
  }
};
