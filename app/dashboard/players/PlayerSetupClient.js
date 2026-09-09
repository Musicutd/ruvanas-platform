"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import WorkflowProgress from "@/app/components/WorkflowProgress";
import { playerWorkflowSteps, safeWorkflowMessage } from "@/lib/guided-workflows.mjs";

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
  const progress = useMemo(() => playerWorkflowSteps({
    configured: activePlayers.length > 0,
    enrolled: activePlayers.some((player) => player.readiness?.checklist?.find((item) => item.key === "ENROLLED")?.complete),
    connected: activePlayers.some((player) => player.readiness?.checklist?.find((item) => item.key === "CONNECTED")?.complete),
    playbackConfirmed: activePlayers.some((player) => player.readiness?.ready)
  }), [activePlayers]);

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
      if (!quiet) setError(safeWorkflowMessage(refreshError, "Unable to refresh player readiness."));
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
      if (!response.ok) throw new Error(data.error || "Unable to prepare the player.");
      setEnrolment(data.player);
      setForm((current) => ({ ...current, name: "" }));
      await refreshReadiness({ quiet: true });
      router.refresh();
    } catch (actionError) {
      setError(safeWorkflowMessage(actionError, "Unable to prepare the player."));
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
      if (!response.ok) throw new Error(data.error || "Unable to replace the player.");
      setEnrolment(data.replacement);
      setReplacement({ playerId: "", note: "", replacementName: "", confirmed: false });
      await refreshReadiness({ quiet: true });
      router.refresh();
    } catch (actionError) {
      setError(safeWorkflowMessage(actionError, "Unable to replace the player."));
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

    <WorkflowProgress title="First player go-live" steps={progress} />

    <aside style={styles.guidance}>
      <strong>Complete one step at a time.</strong>
      <span>The progress line uses live device evidence. It cannot mark a listening area ready until recent playback is confirmed.</span>
    </aside>

    {canManage && zones.length === 0 ? <section style={styles.emptyState}>
      <strong>No locations or playback areas have been created yet. Create your first location and area before preparing a player.</strong>
      <a href="/dashboard/locations?returnTo=players" style={styles.linkButton}>Create your first location</a>
    </section> : null}

    {canManage && zones.length > 0 ? <section style={styles.card}>
      <h2 style={styles.title}>Prepare a player</h2>
      <p style={styles.copy}>Create one enrolled player for each location or playback area, within your plan allowance.</p>
      <form onSubmit={createPlayer} style={styles.form}>
        <label style={styles.field}>Location and zone
          <select value={form.zoneId} onChange={(event) => setForm({ ...form, zoneId: event.target.value })} style={styles.input}>
            {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.locationName} — {zone.name}</option>)}
          </select>
        </label>
        <label style={styles.field}>Player name
          <input value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Marsa main-area player" style={styles.input} />
        </label>
        <button disabled={busy || currentConfigured >= limit || !form.zoneId || form.name.trim().length < 2} style={styles.primary}>{busy === "create" ? "Preparing…" : "Create enrolment"}</button>
      </form>
      {currentConfigured >= limit ? <p style={styles.warning}>Your configured player allowance is full. Replace an existing player to move a listening area to new hardware.</p> : null}
    </section> : null}

    {canManage && activePlayers.length ? <section style={styles.card}>
      <h2 style={styles.title}>Replace a player device</h2>
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
          <input value={replacement.note} maxLength={2000} onChange={(event) => setReplacement({ ...replacement, note: event.target.value })} placeholder="Example: location tablet replaced" style={styles.input} />
        </label>
        <label style={styles.confirm}><input type="checkbox" checked={replacement.confirmed} onChange={(event) => setReplacement({ ...replacement, confirmed: event.target.checked })} /> I understand the current device will stop immediately.</label>
        <button disabled={busy || !replacement.playerId || replacement.note.trim().length < 3 || !replacement.confirmed} style={styles.danger}>{busy === "replace" ? "Replacing…" : "Disable and replace"}</button>
      </form>
    </section> : null}

    {error ? <p style={styles.error} role="alert">{error}</p> : null}
    {enrolment ? <section style={styles.success} aria-live="polite">
      <strong>One-time enrolment code for {enrolment.name}</strong>
      <code style={styles.code}>{enrolment.enrolmentCode}</code>
      <div style={styles.actionRow}>
        <button type="button" onClick={copyEnrolmentCode} style={styles.secondary}>Copy code</button>
        <a href="/player" target="_blank" rel="noreferrer" style={styles.linkButton}>Open player</a>
      </div>
      <span>This code is shown only here and expires {new Date(enrolment.enrolmentExpiresAt).toLocaleString()}.</span>
      <ol style={styles.steps}>
        <li>Open the player on the device that will remain in this location.</li>
        <li>Enter the one-time code and keep the player page open.</li>
        <li>Allow browser audio if the device asks, then start playback.</li>
        <li>Return here; readiness refreshes automatically every 15 seconds.</li>
      </ol>
    </section> : null}

    <section style={styles.card}>
      <div style={styles.sectionHeader}>
        <div><h2 style={styles.title}>Player go-live readiness</h2><p style={styles.copy}>Live evidence from the enrolled device, assigned channel and recent playback.</p></div>
        <button type="button" onClick={() => refreshReadiness()} disabled={refreshing} style={styles.secondary}>{refreshing ? "Refreshing…" : "Refresh status"}</button>
      </div>
      {!playerRows.length ? <p style={styles.copy}>No players have been configured.</p> : <div style={styles.list}>{playerRows.map((player) => {
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
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, padding: 20, borderRadius: 14, background: "var(--rv-surface)", border: "1px solid var(--rv-border)" },
  label: { color: "var(--rv-text-muted)", display: "block", fontSize: 12, fontWeight: 800, letterSpacing: .8, marginBottom: 7, textTransform: "uppercase" },
  card: { marginTop: 18, padding: 22, borderRadius: 14, background: "var(--rv-surface)", border: "1px solid var(--rv-border)" },
  guidance: { display: "grid", gap: 5, marginTop: 18, borderLeft: "4px solid #f4b942", borderRadius: 8, background: "var(--rv-surface)", color: "var(--rv-text)", padding: "13px 15px", lineHeight: 1.45 },
  title: { margin: "0 0 8px", fontSize: 24 },
  copy: { color: "var(--rv-text-muted)", lineHeight: 1.5, margin: "6px 0" },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "end", marginTop: 18 },
  replaceForm: { display: "grid", gap: 12, marginTop: 18 },
  field: { display: "grid", gap: 7, color: "var(--rv-text)", fontSize: 14, fontWeight: 800 },
  input: { minHeight: 44, border: "1px solid var(--rv-border)", borderRadius: 8, padding: "9px 10px", background: "var(--rv-input-bg)", color: "var(--rv-input-text)" },
  primary: { minHeight: 44, border: 0, borderRadius: 8, padding: "10px 15px", background: "#f4b942", color: "#111827", fontWeight: 900 },
  secondary: { minHeight: 40, border: "1px solid var(--rv-border)", borderRadius: 8, padding: "9px 13px", background: "var(--rv-surface-muted)", color: "var(--rv-text)", fontWeight: 900, cursor: "pointer" },
  linkButton: { minHeight: 40, display: "inline-flex", alignItems: "center", borderRadius: 8, padding: "0 13px", background: "#f4b942", color: "#111827", fontWeight: 900, textDecoration: "none" },
  danger: { minHeight: 44, border: "1px solid #ef4444", borderRadius: 8, padding: "10px 15px", background: "var(--rv-error-bg)", color: "var(--rv-error-text)", fontWeight: 900 },
  confirm: { display: "flex", alignItems: "center", gap: 9, color: "var(--rv-error-text)", fontWeight: 800 },
  warning: { color: "var(--rv-warning-text)", fontWeight: 800 },
  error: { padding: 14, borderRadius: 10, background: "var(--rv-error-bg)", color: "var(--rv-error-text)", fontWeight: 800 },
  success: { marginTop: 18, display: "grid", gap: 10, border: "1px solid #4ade80", background: "var(--rv-success-bg)", padding: 18, borderRadius: 12, color: "var(--rv-success-text)" },
  code: { padding: 12, borderRadius: 7, background: "var(--rv-success-bg)", color: "var(--rv-text)", overflowWrap: "anywhere" },
  steps: { margin: "2px 0 0", paddingLeft: 22, lineHeight: 1.7 },
  actionRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  sectionHeader: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap" },
  list: { display: "grid", gap: 12, marginTop: 16 },
  player: { display: "grid", gap: 12, padding: 17, borderRadius: 10, background: "var(--rv-surface)", border: "1px solid var(--rv-border)" },
  playerHeader: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap" },
  readinessBadge: { display: "inline-block", padding: "6px 9px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  ready: { background: "var(--rv-success-bg)", color: "var(--rv-success-text)" },
  attention: { background: "var(--rv-error-bg)", color: "var(--rv-error-text)" },
  waiting: { background: "var(--rv-warning-bg)", color: "var(--rv-warning-text)" },
  retired: { background: "var(--rv-surface)", color: "var(--rv-text)" },
  readinessSummary: { color: "var(--rv-text)", fontWeight: 800, margin: 0 },
  checklist: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 9 },
  checkItem: { display: "flex", gap: 9, padding: 10, borderRadius: 8, background: "var(--rv-surface-muted)" },
  checkPass: { color: "#4ade80", fontWeight: 900 },
  checkPending: { color: "#fbbf24", fontWeight: 900 },
  meta: { color: "var(--rv-text)", fontSize: 12, lineHeight: 1.45, margin: "4px 0 0" },
  emptyState: { marginTop: 18, display: "grid", justifyItems: "start", gap: 12, padding: 20, borderRadius: 12, border: "1px solid #f4b942", background: "var(--rv-warning-bg)", color: "var(--rv-warning-text)" }
};
