"use client";

import { useCallback, useEffect, useState } from "react";

export default function SchoolPublicationControl() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/publication-policy", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Publication controls could not be loaded.");
    setData(payload);
  }, []);
  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  async function update(publishingPolicy) {
    const reason = window.prompt(publishingPolicy === "PUBLIC" ? "Why is the school ready for controlled public publishing?" : "Why is public publishing being withdrawn?", "Policy reviewed by the school owner.");
    if (!reason?.trim()) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/publication-policy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publishingPolicy, reason }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Publication policy could not be changed.");
      setNotice(publishingPolicy === "PUBLIC" ? "Controlled public publishing policy enabled. Every episode still requires separate approval." : `${payload.withdrawnCount || 0} public episode(s) withdrawn immediately.`);
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  if (!data) return <section style={styles.shell}><p style={styles.muted}>{error || "Loading publication controls…"}</p></section>;
  const isPublic = data.profile.publishingPolicy === "PUBLIC";
  const ready = data.readiness?.status === "APPROVED";
  return <section style={styles.shell}>
    <div style={styles.row}><div><p style={styles.eyebrow}>STAGE 9C · CONTROLLED SCHOOL PUBLISHING</p><h2 style={styles.title}>Public publishing policy</h2><p style={styles.muted}>Public release is disabled by default and requires the Ruvanas capability, an approved safeguarding pack, the school policy, staff-approved audio and transcript, and current contributor consent.</p></div><span style={isPublic ? styles.enabled : styles.private}>{isPublic ? "PUBLIC POLICY" : "PRIVATE"}</span></div>
    {error ? <div style={styles.error}>{error}</div> : null}{notice ? <div style={styles.notice}>{notice}</div> : null}
    <div style={styles.grid}><div><strong>Ruvanas capability</strong><p style={styles.muted}>{data.publicPublishingEnabled ? "Enabled" : "Disabled by Ruvanas"}</p></div><div><strong>Safeguarding</strong><p style={styles.muted}>{data.readiness?.status?.replaceAll("_", " ") || "Not submitted"}</p></div><div><strong>Currently public</strong><p style={styles.muted}>{data.publicEpisodeCount} episode(s)</p></div></div>
    <div style={styles.actions}>{!isPublic ? <button style={styles.primary} disabled={working || !data.publicPublishingEnabled || !ready} onClick={() => update("PUBLIC")}>Enable school public policy</button> : <button style={styles.danger} disabled={working} onClick={() => update("PRIVATE")}>Return school to private</button>}{isPublic ? <a style={styles.link} href={data.publicUrl} target="_blank" rel="noreferrer">Open public school page</a> : null}</div>
    <p style={styles.safety}>Students cannot publish. Changing this policy never publishes an episode automatically; a manager must approve every release separately.</p>
  </section>;
}

const styles = {
  shell: { margin: "0 0 24px", border: "1px solid #2b3a54", borderRadius: 16, background: "#121d30", padding: 22 }, row: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, muted: { color: "#aebbd0", lineHeight: 1.5, margin: "6px 0" },
  enabled: { background: "#dcfce7", color: "#166534", borderRadius: 6, padding: "6px 9px", fontSize: 11, fontWeight: 900 }, private: { background: "#334155", color: "#e2e8f0", borderRadius: 6, padding: "6px 9px", fontSize: 11, fontWeight: 900 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 16, border: "1px solid #34445f", borderRadius: 10, padding: 15 }, actions: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 15 },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, danger: { border: "1px solid #f87171", borderRadius: 8, background: "transparent", color: "#fecaca", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }, link: { border: "1px solid #60a5fa", borderRadius: 8, color: "#bfdbfe", padding: "9px 12px", fontWeight: 800, textDecoration: "none" },
  safety: { color: "#93a4bb", fontSize: 12, margin: "14px 0 0" }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginTop: 12 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginTop: 12 }
};
