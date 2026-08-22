import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminStationsPage() {
  const stations = await prisma.station.findMany({
    include: {
      organisation: true,
      streamConfig: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Technical streaming</p>
          <h1 style={styles.title}>All Stations</h1>
          <p style={styles.description}>
            Create a station for an organisation, then configure its private
            Centova streaming details.
          </p>
        </div>

        <Link href="/admin/stations/new" style={styles.addButton}>
          Add station
        </Link>
      </div>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Existing stations</h2>

        {stations.length === 0 ? (
          <p style={styles.emptyState}>No stations have been created yet.</p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Station</th>
                  <th style={styles.tableHeader}>Organisation</th>
                  <th style={styles.tableHeader}>Status</th>
                  <th style={styles.tableHeader}>Streaming</th>
                  <th style={styles.tableHeader}>Created</th>
                  <th style={styles.tableHeader}>Action</th>
                </tr>
              </thead>

              <tbody>
                {stations.map((station) => (
                  <tr key={station.id} style={styles.tableRow}>
                    <td style={styles.tableCellStrong}>{station.name}</td>

                    <td style={styles.tableCell}>
                      {station.organisation?.name || "Unknown organisation"}
                    </td>

                    <td style={styles.tableCell}>
                      <span style={styles.statusBadge}>{station.status}</span>
                    </td>

                    <td style={styles.tableCell}>
                      {station.streamConfig ? (
                        <span style={styles.configured}>Configured</span>
                      ) : (
                        <span style={styles.notConfigured}>Not configured</span>
                      )}
                    </td>

                    <td style={styles.tableCell}>
                      {new Date(station.createdAt).toLocaleDateString()}
                    </td>

                    <td style={styles.tableCell}>
                      <Link
                        href={`/admin/stations/${station.id}/setup`}
                        style={styles.setupLink}
                      >
                        Configure streaming
                      </Link>
                    </td>
                  </tr>
                ))}
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
    background: "#dcfce7",
    color: "#166534",
    fontSize: 12,
    fontWeight: 900
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
