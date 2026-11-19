"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CatalogueAudienceControl from "./CatalogueAudienceControl";
import { CATALOGUE_TIERS, MAX_CATALOGUE_TIER_UPDATES } from "@/lib/catalogue-audience.mjs";
import { catalogueGenreOptions, catalogueRowCanUpdateTier, filterCatalogueRows } from "@/lib/catalogue-track-search.mjs";

export default function CatalogueTrackTable({ rows }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [genreId, setGenreId] = useState("");
  const [selected, setSelected] = useState([]);
  const [tier, setTier] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const genres = useMemo(() => catalogueGenreOptions(rows), [rows]);
  const visible = useMemo(() => filterCatalogueRows(rows, { query, scope, genreId }), [rows, query, scope, genreId]);
  const selectable = [...new Set(visible.filter(catalogueRowCanUpdateTier).map(row => row.track.id))];
  const selectedIds = [...new Set(selected.filter(id => selectable.includes(id)))];
  const allSelected = selectable.length > 0 && selectable.every(id => selectedIds.includes(id));
  const canSelectAll = selectable.length > 0 && selectable.length <= MAX_CATALOGUE_TIER_UPDATES;
  const tierLabel = CATALOGUE_TIERS.find(item => item.level === tier)?.label || "";

  function changeFilter(setter, value) {
    setter(value);
    setSelected([]);
    setConfirmed(false);
    setMessage("");
    setError("");
  }

  function changeSelection(ids) {
    setSelected(ids);
    setConfirmed(false);
    setMessage("");
    setError("");
  }

  async function applyTier() {
    if (saving || !confirmed || !tier || !selectedIds.length || selectedIds.length > MAX_CATALOGUE_TIER_UPDATES) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/catalogue/bulk-audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackIds: selectedIds, minimumCatalogueLevel: tier, rightsConfirmed: true })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update the selected tracks.");
      setMessage(`${result.updatedCount} tracks updated to ${tierLabel}${result.unchangedCount ? `; ${result.unchangedCount} already had this tier` : ""}. Pillars, territories and music rights were preserved.`);
      setSelected([]);
      setConfirmed(false);
      setTier("");
      router.refresh();
    } catch (problem) {
      setError(problem.message || "Could not update the selected tracks. Check their current access before retrying.");
    } finally {
      setSaving(false);
    }
  }

  return <div style={styles.root}>
    <div style={styles.filters} role="search" aria-label="Search catalogue tracks">
      <label style={{ ...styles.label, flex: "2 1 260px" }}>Search songs
        <input type="search" value={query} onChange={event => changeFilter(setQuery, event.target.value)} disabled={saving} placeholder="Song title, artist, band or genre" style={styles.input} />
      </label>
      <label style={styles.label}>Search in
        <select value={scope} onChange={event => changeFilter(setScope, event.target.value)} disabled={saving} style={styles.input}>
          <option value="all">Song, artist / band and genre</option>
          <option value="title">Song title</option>
          <option value="artist">Artist / band</option>
        </select>
      </label>
      <label style={styles.label}>Genre
        <select value={genreId} onChange={event => changeFilter(setGenreId, event.target.value)} disabled={saving} style={styles.input}>
          <option value="">All genres</option>
          {genres.map(genre => <option key={genre.id} value={genre.id}>{genre.name}</option>)}
        </select>
      </label>
      {query || genreId || scope !== "all" ? <button type="button" disabled={saving} onClick={() => { setQuery(""); setScope("all"); setGenreId(""); changeSelection([]); }} style={styles.button}>Clear filters</button> : null}
    </div>

    <div style={styles.resultBar}>
      <strong role="status">{visible.length} of {rows.length} tracks · {selectedIds.length} selected</strong>
      <div style={styles.actions}>
        <button type="button" disabled={saving || !canSelectAll || allSelected} onClick={() => changeSelection(selectable)} style={styles.button}>Select all {selectable.length} matching tracks</button>
        <button type="button" disabled={saving || !selectedIds.length} onClick={() => changeSelection([])} style={styles.button}>Clear selection</button>
      </div>
    </div>
    {selectable.length > MAX_CATALOGUE_TIER_UPDATES ? <small style={styles.hint}>Update up to {MAX_CATALOGUE_TIER_UPDATES} tracks at once. Narrow your search to select all matches, or select individual tracks.</small> : null}

    {selectedIds.length > 0 ? <section style={styles.bulk} aria-label="Bulk tier update">
      <strong>Update tiers for {selectedIds.length} selected tracks</strong>
      <div style={styles.actions}>
        <label style={styles.label}>New tier access
          <select value={tier} onChange={event => { setTier(event.target.value); setConfirmed(false); }} disabled={saving} style={styles.input}>
            <option value="">Choose a tier</option>
            {CATALOGUE_TIERS.map(item => <option key={item.level} value={item.level}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <small>This changes the minimum tier only. Existing pillars, territories, genre controls and rights checks still apply. Changing a ready track can affect subscriber availability immediately.</small>
      <label style={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={saving || !tier} />I confirm the recorded licences cover the chosen tier for these {selectedIds.length} tracks.</label>
      <button type="button" disabled={saving || !confirmed || !tier} onClick={applyTier} style={{ ...styles.button, ...styles.primary }}>{saving ? "Updating selected tracks…" : `Apply ${tierLabel || "tier"} to ${selectedIds.length} selected tracks`}</button>
    </section> : null}
    {message ? <p role="status" style={styles.success}>{message}</p> : null}
    {error ? <p role="alert" style={styles.error}>{error}</p> : null}

    <div style={styles.tableWrapper}>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.tableHeader}><input type="checkbox" aria-label="Select all matching tracks" checked={allSelected} disabled={saving || !canSelectAll} onChange={event => changeSelection(event.target.checked ? selectable : [])} /></th>
          {["Track", "Artist / band", "Mix / BPM", "Genres", "Type", "Status", "Rights", "Subscriber access", "Added"].map(heading => <th key={heading} style={styles.tableHeader}>{heading}</th>)}
        </tr></thead>
        <tbody>{visible.map(row => <tr key={row.id} style={{ borderBottom: "1px solid #cbd5e1", background: row.track && selectedIds.includes(row.track.id) ? "#fffbeb" : "#fff" }}>
          <td style={styles.tableCell}><input type="checkbox" aria-label={`Select ${row.title} by ${row.artist || "unknown artist"}`} checked={Boolean(row.track && selectedIds.includes(row.track.id))} disabled={saving || !catalogueRowCanUpdateTier(row) || (selectedIds.length >= MAX_CATALOGUE_TIER_UPDATES && !selectedIds.includes(row.track.id))} title={catalogueRowCanUpdateTier(row) ? undefined : "Only unarchived music tracks with metadata can receive tier updates"} onChange={event => changeSelection(event.target.checked ? [...selectedIds, row.track.id] : selectedIds.filter(id => id !== row.track.id))} /></td>
          <td style={{ ...styles.tableCell, minWidth: 220 }}><strong>{row.title}</strong><small style={styles.secondary}>{row.originalName}</small></td>
          <td style={styles.tableCell}>{row.artist || "Metadata pending"}</td>
          <td style={styles.tableCell}>{row.track ? `${row.mixName || "—"} / ${row.bpm || "—"}` : "—"}</td>
          <td style={styles.tableCell}>{row.genres.length ? row.genres.map(genre => genre.name).join(", ") : "Uncategorised"}</td>
          <td style={styles.tableCell}>{row.mediaType}</td>
          <td style={styles.tableCell}><span style={styles.badge}>{row.status}</span></td>
          <td style={styles.tableCell}>{row.rightsHolder ? <>{row.rightsHolder}<small style={styles.secondary}>{row.track?.permittedTerritories || "Territories not recorded"}</small></> : "Legacy record"}</td>
          <td style={styles.tableCell}>{row.track ? <CatalogueAudienceControl track={row.track} busy={saving} /> : "No track metadata"}</td>
          <td style={{ ...styles.tableCell, whiteSpace: "nowrap" }}>{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}</td>
        </tr>)}</tbody>
      </table>
      {!visible.length ? <p style={styles.empty}>{rows.length ? "No songs match these filters. Try another title, artist or genre." : "No catalogue tracks have been uploaded yet."}</p> : null}
    </div>
    <small style={styles.hint}>Selections clear when you change a filter. Only unarchived music tracks with metadata can receive tier updates.</small>
  </div>;
}

const styles = {
  root: { display: "grid", gap: 14 },
  filters: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", padding: 16, border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" },
  label: { display: "grid", gap: 6, fontSize: 13, fontWeight: 800, flex: "1 1 170px" },
  input: { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 11px", border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#172033", font: "inherit" },
  resultBar: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13 },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 },
  button: { border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#172033", padding: "10px 12px", fontSize: 13, fontWeight: 800, cursor: "pointer" },
  primary: { background: "#f8bd3f", borderColor: "#d99c18", justifySelf: "start" },
  bulk: { display: "grid", gap: 12, padding: 18, border: "1px solid #d99c18", borderRadius: 9, background: "#fffbeb" },
  confirmation: { display: "flex", gap: 8, alignItems: "start", fontSize: 13, lineHeight: 1.5 },
  tableWrapper: { overflowX: "auto", border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" },
  table: { width: "100%", minWidth: 1000, borderCollapse: "collapse" },
  tableHeader: { padding: "13px 12px", borderBottom: "2px solid #94a3b8", background: "#e2e8f0", color: "#172033", fontSize: 13, fontWeight: 900, textAlign: "left", whiteSpace: "nowrap" },
  tableCell: { padding: "15px 12px", color: "#1e293b", fontSize: 14, verticalAlign: "middle" },
  secondary: { display: "block", marginTop: 5, color: "#64748b", fontSize: 12, lineHeight: 1.4 },
  badge: { display: "inline-block", padding: "4px 8px", borderRadius: 5, background: "#e2e8f0", color: "#334155", fontSize: 12, fontWeight: 900 },
  empty: { padding: "18px 20px", color: "#64748b" },
  hint: { color: "#64748b", lineHeight: 1.5 },
  success: { margin: 0, padding: 12, borderRadius: 6, background: "#dcfce7", color: "#166534" },
  error: { margin: 0, padding: 12, borderRadius: 6, background: "#fee2e2", color: "#991b1b" }
};
