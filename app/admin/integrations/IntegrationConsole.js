"use client";

import { useState } from "react";

const EVENTS = [
  ["campaign.published", "Campaign published"],
  ["player.health_changed", "Player health changed"],
  ["proof.accepted", "Proof accepted"],
  ["production.status_changed", "Production status changed"]
];

const CONNECTION_TYPES = [
  ["OUTGOING_WEBHOOK", "Signed outgoing webhook"],
  ["POS_METRICS", "Sales summaries"],
  ["INVENTORY_METRICS", "Inventory summaries"],
  ["FOOTFALL_METRICS", "Footfall summaries"]
];

async function callApi(path, options) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

export default function IntegrationConsole({ organisations, initialConnections }) {
  const [connections, setConnections] = useState(initialConnections);
  const [draft, setDraft] = useState({ organisationId: organisations[0]?.id || "", name: "", kind: "OUTGOING_WEBHOOK", providerKey: "", endpointUrl: "", subscribedEventTypes: EVENTS.map(([value]) => value) });
  const [notice, setNotice] = useState("");
  const [revealedSecret, setRevealedSecret] = useState("");
  const [working, setWorking] = useState(false);

  function toggleEvent(value) {
    setDraft((item) => ({ ...item, subscribedEventTypes: item.subscribedEventTypes.includes(value) ? item.subscribedEventTypes.filter((entry) => entry !== value) : [...item.subscribedEventTypes, value] }));
  }

  async function create(event) {
    event.preventDefault(); setWorking(true); setNotice(""); setRevealedSecret("");
    try {
      const body = await callApi("/api/admin/integrations/connections", { method: "POST", body: JSON.stringify(draft) });
      const organisation = organisations.find((item) => item.id === draft.organisationId);
      setConnections((items) => [{ ...body.connection, organisation, _count: { events: 0, syncRuns: 0, metricSummaries: 0 }, events: [], syncRuns: [] }, ...items]);
      setRevealedSecret(body.secret || ""); setNotice(body.notice); setDraft({ ...draft, name: "", providerKey: "", endpointUrl: "" }); setWorking(false);
    } catch (error) { setNotice(error.message); setWorking(false); }
  }

  async function action(id, value) {
    if (value === "revoke" && !window.confirm("Permanently revoke this integration? It cannot be reactivated.")) return;
    setWorking(true); setNotice(""); setRevealedSecret("");
    try {
      const body = await callApi(`/api/admin/integrations/connections/${id}`, { method: "PATCH", body: JSON.stringify({ action: value }) });
      setConnections((items) => items.map((item) => item.id === id ? { ...item, ...body.connection } : item));
      if (body.secret) { setRevealedSecret(body.secret); setNotice(body.notice); }
      else setNotice("Integration updated.");
      setWorking(false);
    } catch (error) { setNotice(error.message); setWorking(false); }
  }

  async function dispatch(id) {
    setWorking(true); setNotice("");
    try { const body = await callApi(`/api/admin/integrations/connections/${id}/dispatch`, { method: "POST", body: "{}" }); setNotice(`Delivery run complete: ${body.delivered} of ${body.attempted} events delivered.`); setWorking(false); }
    catch (error) { setNotice(error.message); setWorking(false); }
  }

  return <div style={s.grid}>
    <form style={s.card} onSubmit={create}>
      <p style={s.eyebrow}>New managed connection</p><h2 style={s.h2}>Connect an approved system</h2>
      <label style={s.label}>Organisation<select style={s.input} value={draft.organisationId} onChange={(e) => setDraft({ ...draft, organisationId: e.target.value })}>{organisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label style={s.label}>Connection type<select style={s.input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{CONNECTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label style={s.label}>Connection name<input style={s.input} required minLength="2" maxLength="100" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Reporting webhook" /></label>
      {draft.kind === "OUTGOING_WEBHOOK" ? <>
        <label style={s.label}>HTTPS endpoint<input style={s.input} type="url" required value={draft.endpointUrl} onChange={(e) => setDraft({ ...draft, endpointUrl: e.target.value })} placeholder="https://partner.example/webhooks/ruvanas" /></label>
        <fieldset style={s.fieldset}><legend style={s.legend}>Events</legend>{EVENTS.map(([value, label]) => <label key={value} style={s.check}><input type="checkbox" checked={draft.subscribedEventTypes.includes(value)} onChange={() => toggleEvent(value)} /> {label}</label>)}</fieldset>
      </> : <>
        <label style={s.label}>Provider key<input style={s.input} required minLength="2" maxLength="80" value={draft.providerKey} onChange={(e) => setDraft({ ...draft, providerKey: e.target.value })} placeholder="PARTNER_POS_V1" /></label>
        <p style={s.muted}>After creating this connection, issue a service account with the <strong>metrics:write</strong> scope. The partner submits only aggregated values linked to a Ruvanas location.</p>
      </>}
      <button style={s.primary} disabled={working || (draft.kind === "OUTGOING_WEBHOOK" && !draft.subscribedEventTypes.length)}>Create connection</button>
      {notice ? <p style={s.notice}>{notice}</p> : null}
      {revealedSecret ? <div style={s.secret}><strong>Copy once:</strong><code style={s.code}>{revealedSecret}</code></div> : null}
    </form>
    <section style={s.wide}><p style={s.eyebrow}>Connection status</p><h2 style={s.h2}>Managed integrations</h2>
      {!connections.length ? <p style={s.muted}>No connections yet. Create one when a trusted partner provides its HTTPS endpoint.</p> : connections.map((item) => <article key={item.id} style={s.item}>
        <div style={s.row}><div><strong>{item.name}</strong><p style={s.muted}>{item.organisation.name} · {CONNECTION_TYPES.find(([value]) => value === item.kind)?.[1] || item.kind}{item.endpointUrl ? ` · ${item.endpointUrl}` : ` · ${item.providerKey}`}</p></div><span style={badge(item.status)}>{item.status}</span></div>
        <p style={s.small}>{item.kind === "OUTGOING_WEBHOOK" ? `${item.subscribedEventTypes.join(" · ")} · ${item._count.events} queued history items` : `${item._count.metricSummaries || 0} accepted summaries · ${item._count.syncRuns || 0} import runs`}</p>
        {item.lastErrorMessage ? <p style={s.error}>{item.lastErrorMessage}</p> : null}
        <div style={s.actions}>{item.kind === "OUTGOING_WEBHOOK" && (item.status === "CONNECTED" || item.status === "DEGRADED") ? <button disabled={working} onClick={() => dispatch(item.id)} style={s.primary}>Deliver due events</button> : null}{item.status !== "REVOKED" ? <button disabled={working} onClick={() => action(item.id, item.status === "DISCONNECTED" ? "reconnect" : "disconnect")}>{item.status === "DISCONNECTED" ? "Reconnect" : "Disconnect"}</button> : null}{item.kind === "OUTGOING_WEBHOOK" && item.status !== "REVOKED" ? <button disabled={working} onClick={() => action(item.id, "rotate_secret")}>Rotate secret</button> : null}{item.status !== "REVOKED" ? <button disabled={working} onClick={() => action(item.id, "revoke")} style={s.danger}>Revoke</button> : null}</div>
        {item.events.length ? <details><summary style={s.summary}>Recent deliveries</summary>{item.events.map((event) => <p key={event.id} style={s.small}>{event.eventType} · {event.status} · {event.attemptCount} attempt(s){event.lastError ? ` · ${event.lastError}` : ""}</p>)}</details> : null}
        {item.syncRuns?.length ? <details><summary style={s.summary}>Recent summary imports</summary>{item.syncRuns.map((run) => <p key={run.id} style={s.small}>{new Date(run.createdAt).toLocaleString()} · {run.status} · {run.summary?.acceptedCount || 0} accepted · {run.summary?.duplicateCount || 0} duplicate{run.errorMessage ? ` · ${run.errorMessage}` : ""}</p>)}</details> : null}
      </article>)}
    </section>
  </div>;
}

function badge(status) { return { padding: "5px 9px", borderRadius: 999, fontSize: 12, fontWeight: 900, background: status === "CONNECTED" ? "#dcfce7" : status === "DEGRADED" ? "#fef3c7" : "#e2e8f0", color: status === "CONNECTED" ? "#166534" : status === "DEGRADED" ? "#92400e" : "#334155" }; }
const s = {
  grid: { display: "grid", gridTemplateColumns: "minmax(280px, .85fr) minmax(360px, 1.4fr)", gap: 20, alignItems: "start" }, card: { border: "1px solid #cbd5e1", borderRadius: 10, padding: 18, background: "#fff" }, wide: { border: "1px solid #cbd5e1", borderRadius: 10, padding: 18, background: "#f8fafc" }, item: { border: "1px solid #dbe3ec", borderRadius: 9, padding: 14, background: "#fff", marginTop: 12 }, row: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }, eyebrow: { margin: "0 0 5px", color: "#9a6400", fontSize: 12, fontWeight: 900, letterSpacing: .8, textTransform: "uppercase" }, h2: { margin: "0 0 16px", fontSize: 21 }, label: { display: "grid", gap: 5, marginBottom: 12, fontSize: 13, fontWeight: 800 }, input: { padding: 10, border: "1px solid #94a3b8", borderRadius: 7, background: "white" }, fieldset: { border: "1px solid #cbd5e1", borderRadius: 7, display: "grid", gap: 7, margin: "0 0 14px", padding: 10 }, legend: { fontSize: 13, fontWeight: 900 }, check: { fontSize: 13 }, primary: { border: 0, borderRadius: 7, background: "#f2b233", color: "#111827", padding: "9px 12px", fontWeight: 900, cursor: "pointer" }, danger: { border: "1px solid #dc2626", color: "#991b1b", background: "#fff", borderRadius: 7, padding: "8px 10px", fontWeight: 800 }, actions: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }, muted: { color: "#64748b", fontSize: 13, margin: "4px 0" }, small: { color: "#475569", fontSize: 12, overflowWrap: "anywhere" }, error: { color: "#991b1b", fontSize: 12 }, notice: { padding: 10, background: "#eff6ff", color: "#1e3a8a", borderRadius: 7, fontSize: 13 }, secret: { marginTop: 10, padding: 10, background: "#111827", color: "#fff", borderRadius: 7, fontSize: 12 }, code: { display: "block", marginTop: 6, overflowWrap: "anywhere" }, summary: { fontWeight: 800, cursor: "pointer" }
};

