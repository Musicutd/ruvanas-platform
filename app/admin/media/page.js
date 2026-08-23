import Link from "next/link";
import { prisma } from "@/lib/prisma";

function formatBytes(value) {
  const bytes = Number(value || 0);

  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const amount = bytes / 1024 ** index;

  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!seconds) {
    return "—";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export default async function AdminPromoLibraryPage() {
  const mediaAssets = await prisma.mediaAsset.findMany({
    where: {
      libraryType: "ORGANISATION_PROMO",
      status: {
        notIn: ["ARCHIVED", "DELETED"]
      }
    },
    include: {
      organisation: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Organisation-owned audio</p>
          <h1 style={styles.title}>Promo Library</h1>
          <p style={styles.description}>
            Manage private organisation commercials, jingles, announcements,
            and voiceovers. Music catalogue content is managed separately by
            Ruvanas.
          </p>
        </div>

        <Link href="/admin/media/upload" style={styles.addButton}>
          Upload promotional audio
        </Link>
      </div>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Available promotional audio</h2>

        {mediaAssets.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>No promotional audio is available.</p>
            <p style={styles.emptyDescription}>
              Upload a commercial, jingle, announcement, or voiceover for an
              organisation.
            </p>
            <Link href="/admin/media/upload" style={styles.emptyAction}>
              Upload promotional audio
            </Link>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Name</th>
                  <th style={styles.tableHeader}>Organisation</th>
                  <th style={styles.tableHeader}>Type</th>
                  <th style={styles.tableHeader}>Size</th>
                  <th style={styles.tableHeader}>Duration</th>
                  <th style={styles.tableHeader}>Status</th>
                  <th style={styles.tableHeader}>Uploaded</th>
                </tr>
              </thead>

              <tbody>
                {mediaAssets.map((asset) => (
                  <tr key={asset.id} style={styles.tableRow}>
                    <td style={styles.tableCellStrong}>
                      <div>{asset.name}</div>
                      <div style={styles.originalName}>
                        {asset.originalName}
                      </div>
                    </td>

                    <td style={styles.tableCell}>
                      {asset.organisation?.name || "Unknown organisation"}
                    </td>

                    <td style={styles.tableCell}>
                      <span style={styles.typeBadge}>
                        {asset.mediaType}
                      </span>
                    </td>

                    <td style={styles.tableCell}>
                      {formatBytes(asset.sizeBytes)}
                    </td>

                    <td style={styles.tableCell}>
                      {formatDuration(asset.durationSeconds)}
                    </td>

                    <td style={styles.tableCell}>
                      <span style={styles.statusBadge}>{asset.status}</span>
                    </td>

                    <td style={styles.tableCell}>
                      {new Date(asset.createdAt).toLocaleDateString()}
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
    padding: 22,
    border: "1px dashed #94a3b8",
    borderRadius: 9,
    background: "#ffffff"
  },
  emptyTitle: {
    margin: 0,
    color: "#172033",
    fontSize: 16,
    fontWeight: 900
  },
  emptyDescription: {
    margin: "8px 0 16px",
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.5
  },
  emptyAction: {
    display: "inline-block",
    borderRadius: 7,
    background: "#172033",
    color: "#ffffff",
    padding: "10px 13px",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "none"
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
  originalName: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 600
  },
  typeBadge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 12,
    fontWeight: 900
  },
  statusBadge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#dcfce7",
    color: "#166534",
    fontSize: 12,
    fontWeight: 900
  }
};
