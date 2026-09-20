import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StreamSourceOperations from "./StreamSourceOperations";
import PageHeader from "@/app/components/PageHeader";
import EmptyState from "@/app/components/EmptyState";
import { interfaceMessages } from "@/lib/interface-guidance.mjs";
import { getAdminUser } from "@/lib/requireAdmin";

const stationStatusLabels = {
  DRAFT: "Draft",
  PENDING_SETUP: "Setup needed",
  ACTIVE: "Active",
  PAUSED: "Paused",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled"
};

function needsStreamingDetails(station) {
  return station.status !== "CANCELLED" && !station.streamConfig?.streamUrl;
}

export default async function AdminStationsPage() {
  const adminUser = await getAdminUser();
  const stations = await prisma.station.findMany({
    include: {
      organisation: true,
      streamConfig: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const stationsNeedingDetails = stations.filter(needsStreamingDetails).length;
  const stationsInSetupOrder = [...stations].sort(
    (left, right) => Number(needsStreamingDetails(right)) - Number(needsStreamingDetails(left))
  );

  return (
    <main style={styles.page}>
      <PageHeader
        eyebrow="Radio control"
        title={interfaceMessages.stations.title}
        description="When a subscriber creates a station, add its Centova details here. Streaming is entered manually by a Ruvanas Super Admin; saving details does not start or activate audio."
      >
        <Link href="/admin/stations/new" style={styles.addButton}>
          Add station
        </Link>
      </PageHeader>

      {adminUser?.role === "SUPER_ADMIN" && stationsNeedingDetails > 0 ? (
        <p style={styles.todoNotice}>
          {stationsNeedingDetails} {stationsNeedingDetails === 1 ? "station needs" : "stations need"} streaming details. Open “Add streaming details” in the list below.
        </p>
      ) : null}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Stations · those needing setup first</h2>

        {stations.length === 0 ? (
          <EmptyState
            title={interfaceMessages.stations.emptyTitle}
            description={interfaceMessages.stations.emptyDescription}
            actionHref="/admin/stations/new"
            actionLabel="Add station"
          />
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th scope="col" style={styles.tableHeader}>Station</th>
                  <th scope="col" style={styles.tableHeader}>Organisation</th>
                  <th scope="col" style={styles.tableHeader}>Status</th>
                  <th scope="col" style={styles.tableHeader}>Streaming</th>
                  <th scope="col" style={styles.tableHeader}>Created</th>
                  <th scope="col" style={styles.tableHeader}>Action</th>
                </tr>
              </thead>

              <tbody>
                {stationsInSetupOrder.map((station) => (
                  <tr key={station.id} style={styles.tableRow}>
                    <td style={styles.tableCellStrong}>{station.name}</td>

                    <td style={styles.tableCell}>
                      {station.organisation?.name || "Unknown organisation"}
                    </td>

                    <td style={styles.tableCell}>
                      <span style={{ ...styles.statusBadge, ...(station.status === "ACTIVE" ? styles.activeStatus : styles.inactiveStatus) }}>
                        {stationStatusLabels[station.status] || station.status}
                      </span>
                    </td>

                    <td style={styles.tableCell}>
                      {station.streamConfig?.streamUrl ? (
                        <span style={styles.configured}>Details saved</span>
                      ) : station.status === "CANCELLED" ? (
                        <span style={styles.notConfigured}>Not applicable</span>
                      ) : (
                        <span style={styles.notConfigured}>Needs stream details</span>
                      )}
                    </td>

                    <td style={styles.tableCell}>
                      {new Date(station.createdAt).toLocaleDateString()}
                    </td>

                    <td style={styles.tableCell}>
                      {adminUser?.role === "SUPER_ADMIN" && station.status !== "CANCELLED" ? <Link
                        href={`/admin/stations/${station.id}/setup`}
                        style={styles.setupLink}
                      >
                        {station.streamConfig?.streamUrl ? "Review streaming" : "Add streaming details"}
                      </Link> : <span>{station.status === "CANCELLED" ? "—" : "Super Admin only"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <StreamSourceOperations />
    </main>
  );
}

const styles = {
  page: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "40px 16px 64px",
    color: "#172033"
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 28
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
  description: {
    maxWidth: 650,
    margin: "10px 0 0",
    color: "#475569",
    fontSize: 15,
    lineHeight: 1.55
  },
  addButton: {
    display: "inline-block",
    borderRadius: 7,
    background: "#f4b942",
    color: "#172033",
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 900,
    textDecoration: "none"
  },
  todoNotice: {
    margin: "0 0 20px",
    border: "1px solid #f59e0b",
    borderRadius: 9,
    background: "#fffbeb",
    color: "#78350f",
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 700
  },
  section: {
    padding: 24,
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)"
  },
  sectionTitle: {
    margin: "0 0 18px",
    color: "#172033",
    fontSize: 17,
    fontWeight: 900,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  emptyState: {
    margin: 0,
    color: "#64748b",
    fontSize: 15,
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
    minWidth: 800,
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
    fontSize: 14,
    fontWeight: 600,
    verticalAlign: "middle"
  },
  tableCellStrong: {
    padding: "15px 12px",
    color: "#111827",
    fontSize: 14,
    fontWeight: 900,
    verticalAlign: "middle"
  },
  statusBadge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 900
  },
  activeStatus: {
    background: "#dcfce7",
    color: "#166534"
  },
  inactiveStatus: {
    background: "#e2e8f0",
    color: "#334155"
  },
  configured: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#dcfce7",
    color: "#166534",
    fontSize: 12,
    fontWeight: 800
  },
  notConfigured: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 12,
    fontWeight: 800
  },
  setupLink: {
    color: "#7c4a03",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "underline"
  }
};
