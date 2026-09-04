"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const badgeColours = {
  APPROVED: ["#dcfce7", "#166534"],
  PASSED: ["#dcfce7", "#166534"],
  IN_REVIEW: ["#fef3c7", "#92400e"],
  PENDING: ["#fef3c7", "#92400e"],
  REJECTED: ["#fee2e2", "#991b1b"],
  FAILED: ["#fee2e2", "#991b1b"],
  SUPERSEDED: ["#e2e8f0", "#475569"],
  QUEUED: ["#e0f2fe", "#075985"]
};

function Badge({ value }) {
  const [background, color] = badgeColours[value] || ["#e2e8f0", "#334155"];
  return <span style={{ ...styles.badge, background, color }}>{String(value).replaceAll("_", " ")}</span>;
}

export default function AdminPromoLibraryPage() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");

  async function loadAssets() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/media");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to load the promotional library.");
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the promotional library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets();
  }, []);

  async function review(asset, version, decision) {
    const notes = window.prompt(
      decision === "REJECT"
        ? "Why did this version fail review?"
        : "Optional approval notes:",
      ""
    );
    if (notes === null || (decision === "REJECT" && !notes.trim())) return;

    setWorkingId(version.id);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/promos/${asset.id}/versions/${version.id}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, notes })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The version could not be reviewed.");
      await loadAssets();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "The version could not be reviewed.");
    } finally {
      setWorkingId("");
    }
  }

  async function archive(asset) {
    if (!window.confirm(`Archive "${asset.name}"? Its version and audit history will be retained.`)) return;
    setWorkingId(asset.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/promos/${asset.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The promotional asset could not be archived.");
      setAssets((current) => current.filter((item) => item.id !== asset.id));
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "The promotional asset could not be archived.");
    } finally {
      setWorkingId("");
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Milestone 3A</p>
          <h1 style={styles.title}>Versioned Promo Library</h1>
          <p style={styles.description}>
            Promotional audio now keeps immutable versions, review status, QC evidence, language metadata, and processing work without changing protected playback URLs.
          </p>
        </div>
        <div style={styles.actions}><Link href="/admin/media/music" style={styles.secondaryButton}>Review organisation music</Link><Link href="/admin/media/upload" style={styles.primaryButton}>Upload a promo</Link></div>
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}

      {loading ? (
        <p style={styles.loading}>Loading promotional assets…</p>
      ) : assets.length === 0 ? (
        <section style={styles.empty}>
          <h2 style={styles.emptyTitle}>No promotional assets yet</h2>
          <p style={styles.muted}>Upload the first commercial, jingle, announcement, or voiceover.</p>
          <Link href="/admin/media/upload" style={styles.secondaryButton}>Upload promotional audio</Link>
        </section>
      ) : (
        <div style={styles.assetList}>
          {assets.map((asset) => {
            const latest = asset.versions[0];
            const approved = asset.versions.find((version) => version.id === asset.currentApprovedVersionId);
            return (
              <section key={asset.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <div>
                    <div style={styles.cardTitleLine}>
                      <h2 style={styles.cardTitle}>{asset.name}</h2>
                      <Badge value={asset.status} />
                    </div>
                    <p style={styles.muted}>{asset.organisation.name} · {asset.mediaType} · {asset.languageCode}</p>
                  </div>
                  <div style={styles.actions}>
                    <Link href={`/admin/media/upload?promoAssetId=${asset.id}`} style={styles.secondaryButton}>Add version</Link>
                    <button type="button" onClick={() => archive(asset)} disabled={workingId === asset.id} style={styles.archiveButton}>Archive</button>
                  </div>
                </div>

                <div style={styles.summaryGrid}>
                  <div><span style={styles.label}>Versions</span><strong>{asset.versions.length}</strong></div>
                  <div><span style={styles.label}>Latest</span><strong>{latest ? `v${latest.version}` : "—"}</strong></div>
                  <div><span style={styles.label}>Approved</span><strong>{approved ? `v${approved.version}` : "None"}</strong></div>
                  <div><span style={styles.label}>Updated</span><strong>{new Date(asset.updatedAt).toLocaleDateString()}</strong></div>
                </div>

                <div style={styles.tableWrapper}>
                  <table style={styles.table}>
                    <thead><tr>
                      <th style={styles.th}>Version</th><th style={styles.th}>File</th><th style={styles.th}>Language</th>
                      <th style={styles.th}>Duration</th><th style={styles.th}>Review</th><th style={styles.th}>QC</th>
                      <th style={styles.th}>Processing</th><th style={styles.th}>Preview</th><th style={styles.th}>Actions</th>
                    </tr></thead>
                    <tbody>
                      {asset.versions.map((version) => (
                        <tr key={version.id} style={styles.tr}>
                          <td style={styles.tdStrong}>v{version.version}{version.id === asset.currentApprovedVersionId ? <div style={styles.current}>CURRENT</div> : null}</td>
                          <td style={styles.td}><div>{version.mediaAsset.originalName}</div><small>{formatBytes(version.mediaAsset.sizeBytes)}</small></td>
                          <td style={styles.td}>{version.languageCode}</td>
                          <td style={styles.td}>{formatDuration(version.durationSeconds)}</td>
                          <td style={styles.td}><Badge value={version.status} />{version.qcNotes ? <div style={styles.note}>{version.qcNotes}</div> : null}</td>
                          <td style={styles.td}><Badge value={version.qcStatus} /></td>
                          <td style={styles.td}><div style={styles.jobs}>{version.processingJobs.length ? version.processingJobs.map((job) => <span key={job.id}>{job.jobType.replaceAll("_", " ")}: <Badge value={job.status} /></span>) : <span>Legacy version</span>}</div></td>
                          <td style={styles.td}>{version.mediaAsset.status === "READY" ? <audio controls preload="none" style={styles.audio}><source src={version.mediaAsset.previewUrl} type={version.mediaAsset.mimeType} /></audio> : "Not ready"}</td>
                          <td style={styles.td}>{version.status === "IN_REVIEW" ? <div style={styles.actions}><button disabled={workingId === version.id} onClick={() => review(asset, version, "APPROVE")} style={styles.approveButton}>Approve</button><button disabled={workingId === version.id} onClick={() => review(asset, version, "REJECT")} style={styles.rejectButton}>Reject</button></div> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

const styles = {
  page: { maxWidth: 1380, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  header: { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 22 },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: 0, fontSize: 32, color: "#111827" },
  description: { maxWidth: 780, color: "#475569", lineHeight: 1.55 },
  primaryButton: { display: "inline-block", borderRadius: 7, background: "#f4b942", color: "#172033", padding: "11px 15px", fontWeight: 900, textDecoration: "none" },
  secondaryButton: { display: "inline-block", border: "1px solid #64748b", borderRadius: 7, background: "#fff", color: "#172033", padding: "8px 11px", fontSize: 13, fontWeight: 800, textDecoration: "none" },
  archiveButton: { border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#475569", padding: "8px 11px", fontWeight: 800, cursor: "pointer" },
  approveButton: { border: 0, borderRadius: 6, background: "#166534", color: "#fff", padding: "7px 9px", fontWeight: 800, cursor: "pointer" },
  rejectButton: { border: "1px solid #dc2626", borderRadius: 6, background: "#fff", color: "#b91c1c", padding: "7px 9px", fontWeight: 800, cursor: "pointer" },
  error: { marginBottom: 18, border: "1px solid #fca5a5", borderRadius: 7, background: "#fef2f2", color: "#991b1b", padding: 12, fontWeight: 700 },
  loading: { color: "#64748b", fontWeight: 700 },
  empty: { padding: 24, border: "1px dashed #94a3b8", borderRadius: 10, background: "#f8fafc" },
  emptyTitle: { margin: "0 0 8px" },
  assetList: { display: "grid", gap: 20 },
  card: { border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc", padding: 20, boxShadow: "0 2px 6px rgba(15,23,42,.06)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" },
  cardTitleLine: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  cardTitle: { margin: 0, fontSize: 21 },
  muted: { margin: "6px 0 0", color: "#64748b", lineHeight: 1.45 },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, margin: "18px 0", padding: 14, borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0" },
  label: { display: "block", marginBottom: 4, color: "#64748b", fontSize: 11, fontWeight: 900, textTransform: "uppercase" },
  badge: { display: "inline-block", borderRadius: 5, padding: "3px 7px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" },
  tableWrapper: { overflowX: "auto", border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" },
  table: { width: "100%", minWidth: 1250, borderCollapse: "collapse" },
  th: { padding: "11px 10px", borderBottom: "2px solid #94a3b8", background: "#e2e8f0", fontSize: 12, fontWeight: 900, textAlign: "left", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #e2e8f0" },
  td: { padding: "12px 10px", verticalAlign: "middle", fontSize: 13, color: "#334155" },
  tdStrong: { padding: "12px 10px", verticalAlign: "middle", fontWeight: 900 },
  current: { marginTop: 4, color: "#166534", fontSize: 9, letterSpacing: .5 },
  jobs: { display: "grid", gap: 5, minWidth: 190 },
  note: { marginTop: 5, maxWidth: 180, color: "#64748b", fontSize: 11 },
  audio: { width: 190, maxWidth: "100%" },
  actions: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }
};
