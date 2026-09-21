"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOGUE_TERRITORY_PRESETS } from "@/lib/catalogue-territories.mjs";

const panel = { border: "1px solid #cbd5e1", borderRadius: 12, padding: 18, background: "#f8fafc", marginTop: 18 };
const button = { border: "1px solid #475569", borderRadius: 7, background: "#fff", color: "#172033", padding: "8px 11px", fontWeight: 800, cursor: "pointer" };
const cell = { padding: 9, borderBottom: "1px solid #cbd5e1", verticalAlign: "top", textAlign: "left", fontSize: 12 };
const wrap = { overflowX: "auto", background: "#fff", borderRadius: 8 };
const table = { width: "100%", borderCollapse: "collapse" };
const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";

export default function PromoOnlyConsole({ initial }) {
  const router = useRouter();
  const { config, connection, runs, feedItems, tracks, mappings, genres, configError } = initial;
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [trackTerritories, setTrackTerritories] = useState({});

  function toggleTrackTerritory(trackId, code) {
    setTrackTerritories((current) => {
      const values = current[trackId] || [];
      return { ...current, [trackId]: values.includes(code) ? values.filter((value) => value !== code) : [...values, code] };
    });
  }

  async function post(path, body = undefined, method = "POST") {
    setBusy(path); setNotice("");
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${payload.error || "Action failed."}${payload.code ? ` (${payload.code})` : ""}`);
      setNotice("Saved. The master catalogue and testing status have been refreshed.");
      router.refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(""); }
  }

  function trackAction(track, action, extra = {}) {
    post(`/api/admin/promo-only/tracks/${track.id}`, { action, ...extra }, "PATCH");
  }

  function genreAction(mapping, action, extra = {}) {
    post(`/api/admin/promo-only/genres/${mapping.id}`, { action, ...extra }, "PATCH");
  }

  return <div>
    <section style={panel}>
      <h2>Connection and safe mode</h2>
      <p><strong>{configError || config.mode}</strong> · RSS {config.rssConfigured ? `configured (${config.rssHost})` : "not configured"} · API credentials {config.credentialsConfigured ? "configured" : "not configured"} · audio gate {config.audioDownloadEnabled ? "enabled for AUDIO_TEST only" : "off"} · media transport {config.allowHttpMediaTest ? "HTTP test exception enabled" : "HTTPS only"} · PRODUCTION locked</p>
      <p>Polling: every {config.pollMinutes} minutes · last successful: {formatDate(connection?.lastSuccessfulSyncAt)} · next: {formatDate(connection?.nextSyncAt)} · {connection?._count?.feedItems || 0} feed items · {connection?._count?.tracks || 0} provider tracks.</p>
      <p>Change modes and secrets through server environment settings, never this page. AUDIO_TEST never downloads automatically from a feed poll; select each test track below.</p>
      <button style={button} disabled={Boolean(busy) || !config.enabled || !config.rssConfigured} onClick={() => post("/api/admin/promo-only/sync")}>{busy ? "Working…" : "Run Sync Now"}</button>
      {notice ? <p role="status" style={{ color: "#164e75", fontWeight: 800 }}>{notice}</p> : null}
    </section>
    <section style={panel}><h2>Recent sync history</h2><div style={wrap}><table style={table}><thead><tr>{["Time", "Trigger / mode", "Status", "Fetched", "Enriched", "Rejected", "Safe error"].map((x) => <th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td style={cell}>{formatDate(run.createdAt)}</td><td style={cell}>{run.trigger} / {run.mode}</td><td style={cell}>{run.status}</td><td style={cell}>{run.fetchedCount}</td><td style={cell}>{run.enrichedCount}</td><td style={cell}>{run.rejectedCount}</td><td style={cell}>{run.safeErrorCode || "—"}</td></tr>)}</tbody></table></div>{!runs.length ? <p>No sync has run yet.</p> : null}</section>
    <section style={panel}><h2>Discovered RSS items</h2><div style={wrap}><table style={table}><thead><tr>{["Title", "Provider identity", "Status", "First seen", "Error"].map((x) => <th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{feedItems.map((item) => <tr key={item.id}><td style={cell}>{item.normalizedPayload?.title || "Untitled"}</td><td style={cell}>Track {item.externalTrackId || "—"} / release {item.externalReleaseId || "—"}</td><td style={cell}>{item.status}</td><td style={cell}>{formatDate(item.firstSeenAt)}</td><td style={cell}>{item.lastErrorCode || "—"}</td></tr>)}</tbody></table></div>{!feedItems.length ? <p>No feed items discovered.</p> : null}</section>
    <section style={panel}><h2>Master catalogue provider records</h2><p>Only Super Admin can request a test import. Storage alone does not publish the track; rights evidence and availability still require review.</p><div style={wrap}><table style={{ ...table, minWidth: 1100 }}><thead><tr>{["Track", "Metadata", "Genre", "Provider IDs", "Import", "Tier", "Controls"].map((x) => <th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{tracks.map((track) => <tr key={track.id}>
      <td style={cell}><strong>{track.artist} — {track.title}</strong><br />{track.mixName || "Original"} · {track.bpm || "—"} BPM</td>
      <td style={cell}>{track.label || "—"}<br />{track.durationSeconds ? `${track.durationSeconds}s` : "—"} · {track.releaseDate ? formatDate(track.releaseDate) : "—"}<br />{track.isExplicit ? "Explicit" : track.contentWarning || "—"}</td>
      <td style={cell}>{track.canonicalGenre?.name || "Unmapped"}<br />Original: {track.sourceGenre || "—"}</td>
      <td style={cell}>Track {track.externalTrackId}<br />Title {track.externalTitleId || "—"}<br />Release {track.release?.externalReleaseId || "—"}</td>
      <td style={cell}>{track.importState}<br />{track.audioStatus}<br />{track.track?.rightsReviewStatus || "No audio"}<br />Territories: {track.permittedTerritories?.join(", ") || "not approved"}<br />AutoDJ {track.autoDjReady ? "eligible" : "off"}</td>
      <td style={cell}><select aria-label={`Tier for ${track.title}`} defaultValue={track.minimumCatalogueLevel} onChange={(e) => trackAction(track, "SET_TIER", { minimumCatalogueLevel: e.target.value })} disabled={Boolean(busy)}>{["FOCUSED", "PROFESSIONAL", "PREMIUM"].map((level) => <option key={level}>{level}</option>)}</select></td>
      <td style={cell}><div style={{ display: "grid", gap: 6 }}>
        <button style={button} disabled={Boolean(busy) || !config.credentialsConfigured} onClick={() => trackAction(track, "REFRESH_METADATA")}>Refresh metadata</button>
        {!track.trackId && config.mode === "AUDIO_TEST" && config.audioDownloadEnabled ? <button style={button} disabled={Boolean(busy) || track.status !== "ACTIVE" || !track.canonicalGenre?.active} onClick={() => post(`/api/admin/promo-only/tracks/${track.id}/download`)}>Import test audio</button> : null}
        {!track.trackId && track.audioStatus.startsWith("FAILED") ? <button style={button} disabled={Boolean(busy)} onClick={() => trackAction(track, "RETRY_DOWNLOAD")}>Retry failed import</button> : null}
        {track.trackId && !track.autoDjReady && track.status === "ACTIVE" ? <div style={{ display: "grid", gap: 5 }}><strong>Licence territories</strong>{CATALOGUE_TERRITORY_PRESETS.map((preset) => <label key={preset.code}><input type="checkbox" checked={(trackTerritories[track.id] || []).includes(preset.code)} onChange={() => toggleTrackTerritory(track.id, preset.code)} /> {preset.label}</label>)}<button style={button} disabled={Boolean(busy) || !(trackTerritories[track.id] || []).length} onClick={() => {
          const rightsReference = window.prompt("Enter the reviewed licence/rights reference. API access is not proof of a broadcast licence:");
          if (!rightsReference) return;
          const entered = window.prompt("Enter only the contract-approved Ruvanas uses, separated by commas (RETAIL_RADIO, SCHOOL_RADIO, ONLINE_RADIO, HEALTH_RADIO, FAITH_RADIO, ORGANISATIONS_RADIO):");
          if (!entered) return;
          const permittedUses = [...new Set(entered.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean))];
          const permittedTerritories = (trackTerritories[track.id] || []).join(", ");
          if (window.confirm(`Approve ${track.title} for ${permittedUses.join(", ")} in ${permittedTerritories}? Confirm this is covered by the signed licence.`)) trackAction(track, "ENABLE", { rightsReference, permittedUses, permittedTerritories });
        }}>Approve rights and enable</button><small>Europe means EU/EEA, UK and Switzerland. Select only signed-agreement territories.</small></div> : null}
        {track.status === "ACTIVE" ? <button style={button} disabled={Boolean(busy)} onClick={() => window.confirm("Quarantine this track and remove it from playback eligibility?") && trackAction(track, "QUARANTINE")}>Quarantine</button> : null}
      </div></td>
    </tr>)}</tbody></table></div>{!tracks.length ? <p>No provider metadata yet. Start with DISCOVERY and then METADATA.</p> : null}</section>
    <section style={panel}><h2>Super Admin genres · Promo Only mapping</h2><p>The original API genre is retained even when its Ruvanas classification is renamed, aliased, merged or remapped.</p><div style={wrap}><table style={table}><thead><tr>{["Original provider genre", "Canonical Ruvanas genre", "Mapping", "Auto-created", "Status", "Manage"].map((x) => <th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{mappings.map((mapping) => <tr key={mapping.id}>
      <td style={cell}>{mapping.sourceGenre}</td><td style={cell}>{mapping.catalogGenre?.name}</td><td style={cell}>{mapping.mappingType}</td><td style={cell}>{mapping.autoCreated ? "Yes" : "No"}</td><td style={cell}>{mapping.reviewStatus} · {mapping.active ? "Active" : "Inactive"}</td>
      <td style={cell}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select aria-label={`Remap ${mapping.sourceGenre}`} defaultValue={mapping.catalogGenreId} onChange={(e) => genreAction(mapping, "REMAPPING", { catalogGenreId: e.target.value })} disabled={Boolean(busy)}>{genres.map((genre) => <option value={genre.id} key={genre.id}>{genre.name}</option>)}</select>
        {mapping.reviewStatus === "PENDING" ? <button style={button} disabled={Boolean(busy)} onClick={() => genreAction(mapping, "APPROVE")}>Approve</button> : null}
        <button style={button} disabled={Boolean(busy)} onClick={() => { const name = window.prompt("Rename the canonical Ruvanas genre:", mapping.catalogGenre?.name); if (name) genreAction(mapping, "RENAME", { name }); }}>Rename</button>
        <button style={button} disabled={Boolean(busy)} onClick={() => { const name = window.prompt("Add another spelling from Promo Only that should map to this genre:"); if (name) genreAction(mapping, "ALIAS", { name }); }}>Add alias</button>
        <button style={button} disabled={Boolean(busy)} onClick={() => genreAction(mapping, mapping.active ? "DEACTIVATE" : "ACTIVATE")}>{mapping.active ? "Deactivate" : "Activate"}</button>
        <button style={button} disabled={Boolean(busy)} onClick={() => { const target = window.prompt("Paste the target Ruvanas genre ID to merge this genre into:"); if (target && window.confirm("Merge assignments into the target genre and deactivate this one?")) genreAction(mapping, "MERGE", { catalogGenreId: target }); }}>Merge</button>
      </div></td>
    </tr>)}</tbody></table></div>{!mappings.length ? <p>No provider genre mappings yet.</p> : null}</section>
  </div>;
}
