"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const READINESS_REFRESH_MS = 15_000;

function readinessTone(level) {
  if (level === "READY") return styles.ready;
  if (level === "ACTION_REQUIRED") return styles.attention;
  if (level === "RETIRED") return styles.retired;
  return styles.waiting;
}

function readinessLabel(code) {
  return String(code || "WAITING").replaceAll("_", " ");
}

export default function PlayerSetupClient({ players, zones, canManage, configured, limit }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", zoneId: zones[0]?.id || "" });
  const [replacement, setReplacement] = useState({ playerId: "", note: "", replacementName: "", confirmed: false });
  const [playerRows, setPlayerRows] = useState(players);
  const [currentConfigured, setCurrentConfigured] = useState(configured);
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [enrolment, setEnrolment] = useState(null);
  const activePlayers = useMemo(() => playerRows.filter((player) => player.status !== "DISABLED"), [playerRows]);

  useEffect(() => {
    setPlayerRows(players);
    setCurrentConfigured(configured);
  }, [players, configured]);

  const refreshReadiness = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch("/api/player-setup", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to refresh player readiness.");
      setPlayerRows(data.players);
      setCurrentConfigured(data.configured);
      if (!quiet) setError("");
    } catch (refreshError) {
      if (!quiet) setError(refreshError.message || "Unable to refresh player readiness.");
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => refreshReadiness({ quiet: true }), READINESS_REFRESH_MS);
    return () => window.clearInterval(refreshTimer);
  }, [refreshReadiness]);

  async function createPlayer(event) {
    event.preventDefault();
    setBusy("create"); setError(""); setEnrolment(null);
    try {
      const response = await fetch("/api/player-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to prepare the shop player.");
      setEnrolment(data.player);
      setForm((current) => ({ ...current, name: "" }));
      await refreshReadiness({ quiet: true });
      router.refresh();
    } catch (actionError) {
      setError(actionError.message || "Unable to prepare the shop player.");
    } finally { setBusy(""); }
  }

  async function replacePlayer(event) {
    event.preventDefault();
    setBusy("replace"); setError(""); setEnrolment(null);
    try {
      const response = await fetch(`/api/player-setup/${replacement.playerId}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: replacement.note, replacementName: replacement.replacementName, confirmReplacement: replacement.confirmed })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to replace the shop player.");
      setEnrolment(data.replacement);
      setReplacement({ playerId: "", note: "", replacementName: "", confirmed: false });
      await refreshReadiness({ quiet: true });
      router.refresh();
    } catch (actionError) {
      setError(actionError.message || "Unable to replace the shop player.");
    } finally { setBusy(""); }
  }

  async function copyEnrolmentCode() {
    try {
      await navigator.clipboard.writeText(enrolment.enrolmentCode);
      setError("");
    } catch {
      setError("The code could not be copied automatically. Select it and copy it manually.");
    }
  }

  return <>
    <section style={styles.summary}>
      <div><span style={styles.label}>Configured players</span><strong>{currentConfigured} / {limit}</strong></div>
      <div><span style={styles.label}>Management access</span><strong>{canManage ? "Owner / manager" : "View only"}</strong></div>
      <div><span style={styles.label}>Device rule</span><strong>One device per player</strong></div>
    </section>

    {canManage ? <section style={styles.card}>
      <h2 style={styles.title}>Prepare a shop player</h2>
      <p style={styles.copy}>Create one enrolled player for each shop or playback zone, within your plan allowance.</p>
      <form onSubmit={createPlayer} style={styles.form}>
        <label style={styles.field}>Location and zone
          <select value={form.zoneId} onChange={(event) => setForm({ ...form, zoneId: event.target.value })} style={styles.input}>
            {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.locationName} — {zone.name}</option>)}
          </select>
        </label>
        <label style={styles.field}>Player name
          <input value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Marsa main-shop player" style={styles.input} />
        </label>
        <button disabled={busy || currentConfigured >= limit || !form.zoneId || form.name.trim().length < 2} style={styles.primary}>{busy === "create" ? "Preparing…" : "Create enrolment"}</button>
      </form>
      {currentConfigured >= limit ? <p style={styles.warning}>Your configured player allowance is full. Replace an existing player to move a shop to new hardware.</p> : null}
    </section> : null}

    {canManage && activePlayers.length ? <section style={styles.card}>
      <h2 style={styles.title}>Replace a shop device</h2>
      <p style={styles.copy}>This immediately disables the selected device, releases its active stream, and creates a one-time code for its replacement in the same zone.</p>
      <form onSubmit={replacePlayer} style={styles.replaceForm}>
        <label style={styles.field}>Current player
          <select value={replacement.playerId} onChange={(event) => setReplacement({ ...replacement, playerId: event.target.value })} style={styles.input}>
            <option value="">Choose a player</option>
            {activePlayers.map((player) => <option key={player.id} value={player.id}>{player.locationName} — {player.name}</option>)}
          </select>
        </label>
        <label style={styles.field}>Replacement name (optional)
          <input value={replacement.replacementName} maxLength={120} onChange={(event) => setReplacement({ ...replacement, replacementName: event.target.value })} style={styles.input} />
        </label>
        <label style={styles.field}>Reason
          <input value={replacement.note} maxLength={2000} onChange={(event) => setReplacement({ ...replacement, note: event.target.value })} placeholder="Example: shop tablet replaced" style={styles.input} />
        </label>
        <label style={styles.confirm}><input type="checkbox" checked={replacement.confirmed} onChange={(event) => setReplacement({ ...replacement, confirmed: event.target.checked })} /> I understand the current device will stop immediately.</label>
        <button disabled={busy || !replacement.playerId || replacement.note.trim().length < 3 || !replacement.confirmed} style={styles.danger}>{busy === "replace" ? "Replacing…" : "Disable and replace"}</button>
      </form>
    </section> : null}

    {error ? <p style={styles.error}>{error}</p> : null}
    {enrolment ? <section style={styles.success} aria-live="polite">
      <strong>One-time enrolment code for {enrolment.name}</strong>
      <code style={styles.code}>{enrolment.enrolmentCode}</code>
      <div style={styles.actionRow}>
        <button type="button" onClick={copyEnrolmentCode} style={styles.secondary}>Copy code</button>
        <a href="/player" target="_blank" rel="noreferrer" style={styles.linkButton}>Open shop player</a>
      </div>
      <span>This code is shown only here and expires {new Date(enrolment.enrolmentExpiresAt).toLocaleString()}.</span>
      <ol style={styles.steps}>
        <li>Open the shop player on the device that will remain in this location.</li>
        <li>Enter the one-time code and keep the player page open.</li>
        <li>Allow browser audio if the device asks, then start playback.</li>
        <li>Return here; readiness refreshes automatically every 15 seconds.</li>
      </ol>
    </section> : null}

    <section style={styles.card}>
      <div style={styles.sectionHeader}>
        <div><h2 style={styles.title}>Shop go-live readiness</h2><p style={styles.copy}>Live evidence from the enrolled device, assigned channel and recent playback.</p></div>
        <button type="button" onClick={() => refreshReadiness()} disabled={refreshing} style={styles.secondary}>{refreshing ? "Refreshing…" : "Refresh status"}</button>
      </div>
      {!playerRows.length ? <p style={styles.copy}>No shop players have been configured.</p> : <div style={styles.list}>{playerRows.map((player) => {
        const readiness = player.readiness;
        return <article key={player.id} style={styles.player}>
          <div style={styles.playerHeader}>
            <div><strong>{player.name}</strong><p style={styles.copy}>{player.locationName} / {player.zoneName}</p></div>
            <span style={{ ...styles.readinessBadge, ...readinessTone(readiness.level) }}>{readinessLabel(readiness.code)}</span>
          </div>
          <p style={styles.readinessSummary}>{readiness.summary}</p>
          <div style={styles.checklist}>{readiness.checklist.map((item) => <div key={item.key} style={styles.checkItem}>
            <span aria-hidden="true" style={item.complete ? styles.checkPass : styles.checkPending}>{item.complete ? "✓" : "○"}</span>
            <div><strong>{item.label}</strong><p style={styles.meta}>{item.detail}</p></div>
          </div>)}</div>
          <p style={styles.meta}>Last device contact: {readiness.lastHeartbeatAt ? new Date(readiness.lastHeartbeatAt).toLocaleString() : "Not yet"} · Last playback: {readiness.lastPlaybackAt ? new Date(readiness.lastPlaybackAt).toLocaleString() : "Not yet"}</p>
        </article>;
      })}</div>}
    </section>
  </>;
}

const styles = {
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, padding: 20, borderRadius: 14, background: "#182235", border: "1px solid #2b3a54" },
  label: { color: "#9cacbf", display: "block", fontSize: 12, fontWeight: 800, letterSpacing: .8, marginBottom: 7, textTransform: "uppercase" },
  card: { marginTop: 18, padding: 22, borderRadius: 14, background: "#182235", border: "1px solid #2b3a54" },
  title: { margin: "0 0 8px", fontSize: 24 },
  copy: { color: "#bdc8d9", lineHeight: 1.5, margin: "6px 0" },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "end", marginTop: 18 },
  replaceForm: { display: "grid", gap: 12, marginTop: 18 },
  field: { display: "grid", gap: 7, color: "#dce5f2", fontSize: 14, fontWeight: 800 },
  input: { minHeight: 44, border: "1px solid #64748b", borderRadius: 8, padding: "9px 10px", background: "#fff", color: "#111827" },
  primary: { minHeight: 44, border: 0, borderRadius: 8, padding: "10px 15px", background: "#f4b942", color: "#111827", fontWeight: 900 },
  secondary: { minHeight: 40, border: "1px solid #64748b", borderRadius: 8, padding: "9px 13px", background: "#24334b", color: "#fff", fontWeight: 900, cursor: "pointer" },
  linkButton: { minHeight: 40, display: "inline-flex", alignItems: "center", borderRadius: 8, padding: "0 13px", background: "#f4b942", color: "#111827", fontWeight: 900, textDecoration: "none" },
  danger: { minHeight: 44, border: "1px solid #ef4444", borderRadius: 8, padding: "10px 15px", background: "#3d1820", color: "#fecaca", fontWeight: 900 },
  confirm: { display: "flex", alignItems: "center", gap: 9, color: "#fecaca", fontWeight: 800 },
  warning: { color: "#fde68a", fontWeight: 800 },
  error: { padding: 14, borderRadius: 10, background: "#481b24", color: "#fecaca", fontWeight: 800 },
  success: { marginTop: 18, display: "grid", gap: 10, border: "1px solid #4ade80", background: "#153c2d", padding: 18, borderRadius: 12, color: "#bbf7d0" },
  code: { padding: 12, borderRadius: 7, background: "#0f2e22", color: "#fff", overflowWrap: "anywhere" },
  steps: { margin: "2px 0 0", paddingLeft: 22, lineHeight: 1.7 },
  actionRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  sectionHeader: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap" },
  list: { display: "grid", gap: 12, marginTop: 16 },
  player: { display: "grid", gap: 12, padding: 17, borderRadius: 10, background: "#111c2e", border: "1px solid #30405a" },
  playerHeader: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap" },
  readinessBadge: { display: "inline-block", padding: "6px 9px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  ready: { background: "#14532d", color: "#bbf7d0" },
  attention: { background: "#7f1d1d", color: "#fecaca" },
  waiting: { background: "#4a3513", color: "#fde68a" },
  retired: { background: "#334155", color: "#cbd5e1" },
  readinessSummary: { color: "#e2e8f0", fontWeight: 800, margin: 0 },
  checklist: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 9 },
  checkItem: { display: "flex", gap: 9, padding: 10, borderRadius: 8, background: "#17243a" },
  checkPass: { color: "#4ade80", fontWeight: 900 },
  checkPending: { color: "#fbbf24", fontWeight: 900 },
  meta: { color: "#91a2ba", fontSize: 12, lineHeight: 1.45, margin: "4px 0 0" }
};
