"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

export default function AdminPromoLibraryPage() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");

  async function loadAssets() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/media");

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));

        throw new Error(data.error || "Unable to load promotional audio.");
      }

      const data = await response.json();
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load promotional audio."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets();
  }, []);

  async function handleDelete(asset) {
    const confirmed = window.confirm(
      `Delete "${asset.name}" permanently?\n\nThis removes the file from Cloudflare R2 and the database. It cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(asset.id);
    setError("");

    try {
      const response = await fetch(`/api/media/${asset.id}`, {
        method: "DELETE"
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "The audio file could not be deleted.");
      }

      setAssets((currentAssets) =>
        currentAssets.filter((currentAsset) => currentAsset.id !== asset.id)
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The audio file could not be deleted."
      );
    } finally {
      setDeletingId("");
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Organisation-owned audio</p>
          <h1 style={styles.title}>Promo Library</h1>
          <p style={styles.description}>
            Manage private organisation commercials, jingles, announcements,
            and voiceovers. Deleting a file removes it from storage and frees
            the organisation’s allocated promo-storage space.
          </p>
        </div>

        <Link href="/admin/media/upload" style={styles.addButton}>
          Upload promotional audio
        </Link>
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Available promotional audio</h2>

        {loading ? (
          <p style={styles.loadingState}>Loading promotional audio…</p>
        ) : assets.length === 0 ? (
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
                  <th style={styles.tableHeader}>Action</th>
                </tr>
              </thead>

              <tbody>
                {assets.map((asset) => (
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

                    <td style={styles.tableCell}>
                      <button
                        type="button"
                        onClick={() => handleDelete(asset)}
                        disabled={deletingId === asset.id}
                        style={{
                          ...styles.deleteButton,
                          ...(deletingId === asset.id
                            ? styles.deleteButtonDisabled
                            : {})
                        }}
                      >
                        {deletingId === asset.id ? "Deleting…" : "Delete"}
                      </button>
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
    maxWidth: 1180,
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
    marginBottom: 20
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
    maxWidth: 690,
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
  error: {
    marginBottom: 18,
    border: "1px solid #fca5a5",
    borderRadius: 7,
    background: "#fef2f2",
    color: "#991b1b",
    padding: "12px 13px",
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
  loadingState: {
    margin: 0,
    color: "#64748b",
    fontSize: 15,
    fontWeight: 600
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
    minWidth: 1040,
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
    verticalAlign: "middle",
    minWidth: 230
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
  },
  deleteButton: {
    border: "1px solid #dc2626",
    borderRadius: 7,
    background: "#ffffff",
    color: "#b91c1c",
    padding: "8px 11px",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer"
  },
  deleteButtonDisabled: {
    cursor: "not-allowed",
    opacity: 0.65
  }
};
