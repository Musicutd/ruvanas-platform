"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function defaultDates() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 1_000) return `${Math.max(0, bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1_000;
  let unit = units[0];
  for (let index = 1; size >= 1_000 && index < units.length; index += 1) { size /= 1_000; unit = units[index]; }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function formatCutoff(value) {
  return value ? new Date(value).toLocaleDateString() : "Not configured";
}

export default function SchoolPublicationOperationsClient() {
  const initialDates = useMemo(defaultDates, []);
  const [filters, setFilters] = useState(initialDates);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async (nextFilters) => {
    setWorking(true); setError("");
    try {
      const query = new URLSearchParams(nextFilters);
      const response = await fetch(`/api/school-radio/publication-operations?${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "School publication operations could not be loaded.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setWorking(false); }
  }, []);

  useEffect(() => { load(initialDates); }, [initialDates, load]);
  const report = data?.report;
  const exportUrl = report ? `/api/school-radio/publication-operations/export?${new URLSearchParams(filters)}` : "#";

  return <section style={styles.shell}>
    <div style={styles.header}>
      <div><p style={styles.eyebrow}>STAGE 10A · SCHOOL PUBLISHING OPERATIONS</p><h2 style={styles.title}>Public delivery evidence</h2><p style={styles.muted}>Confirm that public school content is being offered while keeping reporting aggregate and privacy-safe.</p></div>
      <span style={styles.badge}>MANAGERS ONLY</span>
    </div>
    <form style={styles.filters} onSubmit={(event) => { event.preventDefault(); load(filters); }}>
      <label style={styles.label}>From<input style={styles.input} type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} required /></label>
      <label style={styles.label}>To<input style={styles.input} type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} required /></label>
      <button style={styles.primary} disabled={working}>{working ? "Checking…" : "Refresh evidence"}</button>
      {report ? <a style={styles.export} href={exportUrl}>Download CSV</a> : null}
    </form>
    {error ? <div style={styles.error}>{error}</div> : null}
    {report ? <>
      <div style={styles.metrics}>
        <div><strong>{report.summary.currentPublicEpisodes}</strong><span>Currently public episodes</span></div>
        <div><strong>{report.summary.metadataListingCount}</strong><span>Metadata listings</span></div>
        <div><strong>{report.summary.audioRequestCount}</strong><span>Audio delivery requests</span></div>
        <div><strong>{formatBytes(report.summary.audioBytesOffered)}</strong><span>Audio bytes offered</span></div>
      </div>
      <div style={styles.operations}>
        <article style={styles.card}><h3 style={styles.cardTitle}>Release activity</h3><p style={styles.muted}>{report.summary.publishedDecisionCount} published · {report.summary.unpublishedDecisionCount} unpublished · {report.summary.autoWithdrawnDecisionCount} automatically withdrawn during this period.</p></article>
        <article style={styles.card}><h3 style={styles.cardTitle}>Retention preview</h3><p style={styles.muted}>Raw recording cutoff: <strong style={styles.strong}>{formatCutoff(report.retention.rawRecordingCutoff)}</strong><br />Consent evidence cutoff: <strong style={styles.strong}>{formatCutoff(report.retention.consentEvidenceCutoff)}</strong></p><p style={styles.preview}>Preview only — no files, records, or consent evidence are deleted here.</p></article>
      </div>
      <div style={styles.episodeList}><h3 style={styles.cardTitle}>Episode evidence</h3>{!report.episodes.length ? <p style={styles.muted}>No origin-delivery evidence was recorded in this period.</p> : report.episodes.map((episode) => <div key={episode.id} style={styles.episode}><div><strong>{episode.title}</strong><p style={styles.muted}>{episode.series}</p></div><div style={styles.episodeCounts}>{episode.totals.metadataListingCount} listings · {episode.totals.audioRequestCount} audio requests · {formatBytes(episode.totals.audioBytesOffered)} offered</div></div>)}</div>
      <p style={styles.notice}>{data.notice}</p>
    </> : <p style={styles.muted}>{working ? "Loading aggregate evidence…" : "Choose a reporting period."}</p>}
  </section>;
}

const styles = {
  shell: { margin: "0 0 24px", border: "1px solid #2b3a54", borderRadius: 16, background: "#121d30", padding: 22 },
  header: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 },
  muted: { color: "#aebbd0", lineHeight: 1.5, margin: "6px 0" }, strong: { color: "#f8fafc" }, badge: { background: "#dbeafe", color: "#1e40af", borderRadius: 6, padding: "6px 9px", fontSize: 11, fontWeight: 900 },
  filters: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", margin: "18px 0" }, label: { display: "grid", gap: 6, color: "#dce5f3", fontWeight: 800, fontSize: 12 }, input: { border: "1px solid #61708a", borderRadius: 8, padding: "9px 10px", font: "inherit" },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, export: { border: "1px solid #60a5fa", borderRadius: 8, color: "#bfdbfe", padding: "9px 12px", fontWeight: 800, textDecoration: "none" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }, operations: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginTop: 12 }, card: { border: "1px solid #34445f", borderRadius: 10, padding: 15, background: "#131e30" }, cardTitle: { margin: "0 0 8px" },
  preview: { color: "#fde68a", fontSize: 12, margin: "10px 0 0" }, episodeList: { marginTop: 12, border: "1px solid #34445f", borderRadius: 10, padding: 15 }, episode: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", borderTop: "1px solid #34445f", padding: "12px 0" }, episodeCounts: { color: "#cbd5e1", fontSize: 13, textAlign: "right" },
  notice: { color: "#93a4bb", fontSize: 12, lineHeight: 1.5, margin: "14px 0 0" }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, margin: "12px 0" }
};
