"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOGUE_TERRITORY_PRESETS } from "@/lib/catalogue-territories.mjs";

const USES = ["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO", "HEALTH_RADIO", "FAITH_RADIO", "ORGANISATIONS_RADIO"];
const initial = { name: "", providerKey: "", apiBaseUrl: "", tokenUrl: "", cataloguePath: "/v1/catalogue", usageReportPath: "", clientId: "", clientSecret: "", oauthScopes: "catalogue.read usage.write", defaultMinimumCatalogueLevel: "FOCUSED", defaultPermittedTerritories: "", defaultPermittedUses: [...USES], syncIntervalMinutes: 60 };

async function call(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function date(value) { return value ? new Date(value).toLocaleString() : "—"; }
function path(id, suffix = "") { return `/api/admin/music-distributors/${id}${suffix}`; }

export default function MusicDistributorConsole({ initialConnections }) {
  const router = useRouter();
  const connections = initialConnections;
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  async function create(event) {
    event.preventDefault(); setBusy("create"); setNotice("");
    try {
      await call("/api/admin/music-distributors", { method: "POST", body: JSON.stringify({ ...form, oauthScopes: form.oauthScopes.split(/[ ,]+/).filter(Boolean), defaultPermittedTerritories: form.defaultPermittedTerritories.split(/[ ,]+/).map((item) => item.toUpperCase()).filter(Boolean), usageReportPath: form.usageReportPath || null }) });
      setForm(initial); setNotice("Draft distributor connection created. Test OAuth authentication before activation."); router.refresh();
    } catch (error) { setNotice(error.message); } finally { setBusy(""); }
  }

  async function action(connection, actionName) {
    const key = `${connection.id}:${actionName}`; setBusy(key); setNotice("");
    try {
      const body = await call(path(connection.id), { method: "PATCH", body: JSON.stringify({ action: actionName }) });
      setNotice(body.notice || `${connection.name}: ${actionName.toLowerCase()} completed.`); router.refresh();
    } catch (error) { setNotice(error.message); } finally { setBusy(""); }
  }

  async function sync(connection, kind) {
    const key = `${connection.id}:sync`; setBusy(key); setNotice("");
    try {
      const body = await call(path(connection.id, "/sync"), { method: "POST", body: JSON.stringify({ kind }) });
      setNotice(`${connection.name}: ${body.result.tracksReceived} tracks received; ${body.result.createdCount} created, ${body.result.updatedCount} updated and ${body.result.takenDownCount} taken down.`); router.refresh();
    } catch (error) { setNotice(error.message); } finally { setBusy(""); }
  }

  async function report(connection, event) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const key = `${connection.id}:report`; setBusy(key); setNotice("");
    try {
      const body = await call(path(connection.id, "/usage-report"), { method: "POST", body: JSON.stringify({ periodFrom: data.get("periodFrom"), periodUntil: data.get("periodUntil") }) });
      setNotice(`${connection.name}: ${body.result.eventCount} usage events delivered.`); router.refresh();
    } catch (error) { setNotice(error.message); } finally { setBusy(""); }
  }

  async function takedown(connection, track) {
    const reason = window.prompt(`Reason for immediately taking down “${track.artist} — ${track.title}”?`);
    if (!reason) return;
    const key = `${track.id}:takedown`; setBusy(key); setNotice("");
    try {
      await call(path(connection.id, `/tracks/${track.id}/takedown`), { method: "POST", body: JSON.stringify({ reason }) });
      setNotice(`${track.artist} — ${track.title} was removed from catalogue eligibility.`); router.refresh();
    } catch (error) { setNotice(error.message); } finally { setBusy(""); }
  }

  function toggleUse(value) { setForm((current) => ({ ...current, defaultPermittedUses: current.defaultPermittedUses.includes(value) ? current.defaultPermittedUses.filter((item) => item !== value) : [...current.defaultPermittedUses, value] })); }

  return <div style={s.stack}>
    {notice ? <p role="status" style={s.message}>{notice}</p> : null}
    <form onSubmit={create} style={s.card}>
      <div style={s.heading}><div><p style={s.eyebrow}>NEW CONNECTION</p><h2 style={s.h2}>Prepare a distributor</h2></div><span style={s.badge}>Draft first</span></div>
      <div style={s.grid}>
        <label style={s.label}>Display name<input style={s.input} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Distributor name" /></label>
        <label style={s.label}>Provider key<input style={s.input} required value={form.providerKey} onChange={(e) => setForm({ ...form, providerKey: e.target.value.toUpperCase() })} placeholder="DISTRIBUTOR_KEY" /></label>
        <label style={s.label}>API base URL<input style={s.input} required type="url" value={form.apiBaseUrl} onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })} placeholder="https://api.distributor.example" /></label>
        <label style={s.label}>OAuth token URL<input style={s.input} required type="url" value={form.tokenUrl} onChange={(e) => setForm({ ...form, tokenUrl: e.target.value })} /></label>
        <label style={s.label}>Catalogue path<input style={s.input} required value={form.cataloguePath} onChange={(e) => setForm({ ...form, cataloguePath: e.target.value })} /></label>
        <label style={s.label}>Usage-report path<input style={s.input} value={form.usageReportPath} onChange={(e) => setForm({ ...form, usageReportPath: e.target.value })} placeholder="/v1/usage" /></label>
        <label style={s.label}>OAuth client ID<input style={s.input} required autoComplete="off" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} /></label>
        <label style={s.label}>OAuth client secret<input style={s.input} required type="password" autoComplete="new-password" minLength="12" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} /></label>
        <label style={s.label}>OAuth scopes<input style={s.input} value={form.oauthScopes} onChange={(e) => setForm({ ...form, oauthScopes: e.target.value })} /></label>
        <label style={s.label}>Default catalogue tier<select style={s.input} value={form.defaultMinimumCatalogueLevel} onChange={(e) => setForm({ ...form, defaultMinimumCatalogueLevel: e.target.value })}><option>FOCUSED</option><option>PROFESSIONAL</option><option>PREMIUM</option></select></label>
        <div style={s.label}>Contract-approved territories
          <div style={s.scopes}>{CATALOGUE_TERRITORY_PRESETS.map((preset) => <label key={preset.code} style={s.scope}><input type="checkbox" checked={form.defaultPermittedTerritories.split(/[ ,]+/).includes(preset.code)} onChange={(e) => { const codes = form.defaultPermittedTerritories.split(/[ ,]+/).filter(Boolean); setForm({ ...form, defaultPermittedTerritories: (e.target.checked ? [...codes, preset.code] : codes.filter((code) => code !== preset.code)).join(", ") }); }} /> {preset.label}</label>)}</div>
          <input style={s.input} value={form.defaultPermittedTerritories} onChange={(e) => setForm({ ...form, defaultPermittedTerritories: e.target.value.toUpperCase() })} placeholder="EUROPE, US, CA (or exact country codes)" />
          <small style={s.muted}>Europe means EU/EEA, UK and Switzerland. Select only territories confirmed in the signed agreement; API data cannot expand this limit.</small>
        </div>
        <label style={s.label}>Sync every minutes<input style={s.input} type="number" min="15" max="10080" value={form.syncIntervalMinutes} onChange={(e) => setForm({ ...form, syncIntervalMinutes: Number(e.target.value) })} /></label>
      </div>
      <div style={s.scopes}>{USES.map((use) => <label key={use} style={s.scope}><input type="checkbox" checked={form.defaultPermittedUses.includes(use)} onChange={() => toggleUse(use)} /> {use.replaceAll("_", " ")}</label>)}</div>
      <button style={s.primary} disabled={busy === "create" || !form.defaultPermittedUses.length || !form.defaultPermittedTerritories.trim()}>{busy === "create" ? "Creating…" : "Create draft connection"}</button>
    </form>

    {!connections.length ? <div style={s.empty}><strong>No distributors configured</strong><span>Create a Draft only after the distributor supplies sandbox credentials and API documentation.</span></div> : null}
    {connections.map((connection) => <section key={connection.id} style={s.card}>
      <div style={s.heading}><div><p style={s.eyebrow}>{connection.providerKey}</p><h2 style={s.h2}>{connection.name}</h2><p style={s.muted}>{new URL(connection.apiBaseUrl).origin} · OAuth client credentials protected</p></div><span style={{ ...s.badge, ...(connection.status === "ACTIVE" ? s.good : connection.status === "DEGRADED" ? s.bad : {}) }}>{connection.status}</span></div>
      <div style={s.summary}><span><strong>{connection._count.tracks}</strong> tracks</span><span><strong>{connection._count.releases}</strong> releases</span><span><strong>{connection._count.collections}</strong> collections</span><span><strong>{connection.defaultMinimumCatalogueLevel}</strong> default tier</span><span><strong>{connection.defaultPermittedTerritories.join(", ") || "None"}</strong> territory limit</span><span><strong>{date(connection.lastSuccessfulSyncAt)}</strong> last sync</span><span><strong>{connection.consecutiveFailures}</strong> failures</span></div>
      <div style={s.actions}>
        <button style={s.secondary} disabled={Boolean(busy)} onClick={() => action(connection, "TEST")}>Test OAuth</button>
        {connection.status === "DRAFT" || connection.status === "PAUSED" || connection.status === "DEGRADED" ? <button style={s.primarySmall} disabled={Boolean(busy)} onClick={() => action(connection, "ACTIVATE")}>Activate</button> : null}
        {connection.status === "ACTIVE" ? <button style={s.secondary} disabled={Boolean(busy)} onClick={() => action(connection, "PAUSE")}>Pause</button> : null}
        {connection.status !== "REVOKED" ? <button style={s.secondary} disabled={Boolean(busy)} onClick={() => sync(connection, connection.syncCursor ? "DELTA" : "FULL")}>Synchronise now</button> : null}
        {connection.status !== "REVOKED" ? <button style={s.danger} disabled={Boolean(busy)} onClick={() => window.confirm("Permanently revoke this distributor connection?") && action(connection, "REVOKE")}>Revoke</button> : null}
      </div>

      <div style={s.two}>
        <div style={s.panel}><h3 style={s.h3}>Recent synchronisation</h3>{connection.syncRuns.length ? connection.syncRuns.map((run) => <p key={run.id} style={s.row}><span>{run.kind} · {run.status}</span><small>{run.tracksReceived} received · {run.createdCount} new · {run.updatedCount} changed · {run.takenDownCount} removed · {run.safeErrorCode || date(run.completedAt)}</small></p>) : <p style={s.muted}>No synchronisation has run.</p>}</div>
        <form style={s.panel} onSubmit={(event) => report(connection, event)}><h3 style={s.h3}>Usage delivery</h3><p style={s.muted}>Send provider identifiers, playback time, duration, territory and permitted use—never subscriber identities.</p><div style={s.grid}><label style={s.label}>From<input style={s.input} name="periodFrom" type="date" required /></label><label style={s.label}>Until<input style={s.input} name="periodUntil" type="date" required /></label></div><button style={s.secondary} disabled={Boolean(busy) || !connection.usageReportPath}>Deliver usage report</button>{!connection.usageReportPath ? <p style={s.warning}>No usage-report path configured.</p> : null}</form>
      </div>

      <div style={s.panel}><h3 style={s.h3}>Recently changed catalogue tracks</h3><div style={s.tableWrap}><table style={s.table}><thead><tr>{["Track", "Identifiers", "Tier", "Rights", "Status", "Control"].map((label) => <th key={label} style={s.th}>{label}</th>)}</tr></thead><tbody>{connection.tracks.map((track) => <tr key={track.id}><td style={s.td}><strong>{track.artist} — {track.title}</strong></td><td style={s.td}>{track.externalTrackId}<br />{track.isrc || "No ISRC"}</td><td style={s.td}>{track.minimumCatalogueLevel}</td><td style={s.td}>{track.permittedTerritories.join(", ") || "None"}<br />{track.permittedUses.map((item) => item.replaceAll("_", " ")).join(", ") || "None"}</td><td style={s.td}>{track.status}</td><td style={s.td}>{track.status === "ACTIVE" ? <button style={s.danger} disabled={Boolean(busy)} onClick={() => takedown(connection, track)}>Immediate takedown</button> : "Unavailable"}</td></tr>)}</tbody></table>{!connection.tracks.length ? <p style={s.muted}>No tracks imported.</p> : null}</div></div>
    </section>)}
  </div>;
}

const s = {
  stack: { display: "grid", gap: 22 }, card: { padding: 22, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" }, heading: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }, eyebrow: { margin: "0 0 5px", color: "#9a6400", fontSize: 11, fontWeight: 900, letterSpacing: 1 }, h2: { margin: 0, fontSize: 23 }, h3: { margin: "0 0 10px", fontSize: 17 }, badge: { borderRadius: 999, padding: "7px 10px", background: "#e2e8f0", color: "#334155", fontSize: 11, fontWeight: 900 }, good: { background: "#dcfce7", color: "#166534" }, bad: { background: "#fee2e2", color: "#991b1b" }, muted: { color: "#64748b", fontSize: 12, lineHeight: 1.5 }, warning: { color: "#8a5a00", fontSize: 12, fontWeight: 800 }, message: { margin: 0, padding: 13, borderRadius: 8, background: "#e8f4ff", color: "#164e75", fontWeight: 750 }, grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }, label: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 }, input: { width: "100%", boxSizing: "border-box", minHeight: 42, padding: "9px 10px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#172033" }, scopes: { display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }, scope: { padding: "8px 9px", border: "1px solid #cbd5e1", borderRadius: 7, background: "#fff", fontSize: 11, fontWeight: 750 }, primary: { minHeight: 42, padding: "9px 14px", border: 0, borderRadius: 7, background: "#172033", color: "#fff", fontWeight: 850 }, primarySmall: { padding: "8px 11px", border: 0, borderRadius: 7, background: "#172033", color: "#fff", fontWeight: 850 }, secondary: { padding: "8px 11px", border: "1px solid #64748b", borderRadius: 7, background: "#fff", color: "#172033", fontWeight: 800 }, danger: { padding: "7px 9px", border: "1px solid #b42318", borderRadius: 7, background: "#fff", color: "#b42318", fontWeight: 800 }, actions: { display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }, summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16 }, two: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 14 }, panel: { marginTop: 14, padding: 16, border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" }, row: { display: "grid", gap: 3, padding: "9px 0", borderBottom: "1px solid #e2e8f0", fontSize: 13 }, empty: { display: "grid", gap: 6, padding: 24, border: "1px dashed #94a3b8", borderRadius: 10, color: "#475569" }, tableWrap: { overflowX: "auto" }, table: { width: "100%", minWidth: 900, borderCollapse: "collapse" }, th: { padding: 9, borderBottom: "2px solid #94a3b8", textAlign: "left", fontSize: 11 }, td: { padding: 9, borderBottom: "1px solid #e2e8f0", fontSize: 12, verticalAlign: "top" }
};
