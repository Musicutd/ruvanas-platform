"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./programming.module.css";

const healthClass = (status) => status === "HEALTHY" ? styles.publishedBadge : status === "UNKNOWN" ? styles.draftBadge : styles.healthWarning;

export default function ExternalLiveWorkspace() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/external-live", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load External Live.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(source, action) {
    setBusy(`${action}:${source.id}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/external-live/${source.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Unable to ${action.toLowerCase()} this source.`);
      setNotice(action === "PROBE" ? `Connection test ${payload.probe.status.toLowerCase()}.` : action === "ACTIVATE" ? `${source.name} is now the authoritative live source for ${source.channel.name}.` : `${source.name} has been ${action === "ARCHIVE" ? "archived" : "taken off air"}.`);
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setBusy(""); }
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading External Live…</div></section>;
  const sources = data?.sources || [];
  return <section className={styles.panel} aria-labelledby="external-live-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>EXTERNAL LIVE</p><h2 id="external-live-title">Bring a live source on air safely</h2></div><span className={styles.count}>{sources.filter((source) => source.status === "ACTIVE").length} live</span></div>
    <p className={styles.panelIntro}>Ruvanas Super Admin prepares the streaming source and protects its credentials. You can test and control an approved source without entering server details here.</p>
    <div className={styles.safetyBanner}><strong>Protected by design</strong><span>Credentials are encrypted and are never shown in the player manifest. An unhealthy or expired source fails safely to the next approved programming source.</span></div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {sources.length ? <div className={styles.externalLiveGrid}>{sources.map((source) => <article className={source.status === "ACTIVE" ? styles.externalLiveActive : styles.externalLiveCard} key={source.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{source.name}</strong><span>{source.channel.name} · {source.endpointHost}</span></div><span className={source.status === "ACTIVE" ? styles.liveSourceBadge : styles.draftBadge}>{source.status}</span></div>
      <div className={styles.liveSourceMeta}><span className={healthClass(source.healthStatus)}>{source.healthStatus}</span><span>{source.providerKey.replaceAll("_", " ")}</span><span>{source.credentialType === "NONE" ? "Public endpoint" : `${source.credentialType} credential protected`}</span></div>
      <p>{source.lastHealthCheckedAt ? `Last checked ${new Date(source.lastHealthCheckedAt).toLocaleString()}${source.lastLatencyMs !== null ? ` · ${source.lastLatencyMs} ms` : ""}` : "Connection not tested yet."}</p>
      {(source.startsAt || source.endsAt) ? <small>Window: {source.startsAt ? new Date(source.startsAt).toLocaleString() : "now"} → {source.endsAt ? new Date(source.endsAt).toLocaleString() : "open ended"}</small> : <small>Open-ended controlled live window</small>}
      {source.canControl ? <div className={styles.cardActions}><button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => act(source, "PROBE")}>Test connection</button>{source.status !== "ACTIVE" && source.healthStatus === "HEALTHY" ? <button type="button" className={styles.primaryButton} disabled={busy !== ""} onClick={() => act(source, "ACTIVATE")}>Take live</button> : null}{source.status === "ACTIVE" ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => act(source, "SUSPEND")}>Take off air</button> : null}{source.canArchive ? <button type="button" className={styles.secondaryButton} disabled={busy !== "" || source.status === "ACTIVE"} onClick={() => act(source, "ARCHIVE")}>Archive</button> : null}</div> : null}
    </article>)}</div> : <div className={styles.emptyState}>No external live sources have been prepared by Ruvanas Super Admin yet.</div>}
    {data?.djAccess ? <div className={styles.notice}>Presenter access active for this browser: {data.djAccess.label}. It ends {new Date(data.djAccess.endsAt).toLocaleString()}.</div> : null}
    <div className={styles.readOnlyMessage}>Only Ruvanas Super Admin enters external source URLs and credentials. Existing approved sources remain available for controlled live use.</div>
  </section>;
}
