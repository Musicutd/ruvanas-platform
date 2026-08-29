"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const COMMANDS = [
  ["PING", "Connection check"],
  ["REFRESH_STATE", "Refresh player state"],
  ["REFRESH_MANIFEST", "Refresh playback plan"],
  ["COLLECT_DIAGNOSTICS", "Collect safe diagnostics"]
];

export default function PlayerCommandOperations({ canManageLifecycle }) {
  const router = useRouter();
  const [report, setReport] = useState(null);
  const [playerId, setPlayerId] = useState("");
  const [kind, setKind] = useState("PING");
  const [note, setNote] = useState("");
  const [replacementName, setReplacementName] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/players/commands", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load player operations.");
      setReport(data);
      setPlayerId((current) => current || data.players.find((player) => player.status !== "DISABLED" && player.enrolledAt)?.id || "");
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load player operations.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const selected = useMemo(() => report?.players.find((player) => player.id === playerId), [playerId, report]);

  async function requestCommand() {
    setBusy("command");
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/players/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, kind })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to request the diagnostic.");
      setResult({ message: "The diagnostic was queued. It will expire safely if the player does not collect it." });
      await load();
    } catch (actionError) {
      setError(actionError.message || "Unable to request the diagnostic.");
    } finally {
      setBusy("");
    }
  }

  async function cancel(commandId) {
    setBusy(`cancel:${commandId}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/players/commands/${commandId}`, { method: "PATCH" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to cancel the command.");
      await load();
    } catch (actionError) {
      setError(actionError.message || "Unable to cancel the command.");
    } finally {
      setBusy("");
    }
  }

  async function lifecycle(action) {
    setBusy(action);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/admin/players/${playerId}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note, replacementName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the player.");
      setResult(data.replacement ? {
        message: "The old session is revoked and the replacement is ready to enrol.",
        replacement: data.replacement
      } : { message: "The player session was revoked and the device was disabled." });
      setNote("");
      setReplacementName("");
      setPlayerId("");
      await load();
      router.refresh();
    } catch (actionError) {
      setError(actionError.message || "Unable to update the player.");
    } finally {
      setBusy("");
    }
  }

  if (!report) return <section style={styles.card}><p style={styles.muted}>{error || "Loading controlled player operations…"}</p></section>;
  const activePlayers = report.players.filter((player) => player.status !== "DISABLED" && player.enrolledAt);

  return <section style={styles.card}>
    <div style={styles.header}>
      <div>
        <p style={styles.eyebrow}>STAGE 11B · CONTROLLED DEVICE OPERATIONS</p>
        <h2 style={styles.title}>Diagnostics and replacement</h2>
        <p style={styles.muted}>Only allow-listed checks are sent. Commands expire, the device reports a bounded result, and every action is audited. No restart, playback, schedule, or content command is available here.</p>
      </div>
      <button type="button" onClick={load} style={styles.secondary}>Refresh</button>
    </div>

    <div style={styles.controls}>
      <label style={styles.label}>Player
        <select value={playerId} onChange={(event) => { setPlayerId(event.target.value); setResult(null); }} style={styles.input}>
          <option value="">Select an active player</option>
          {activePlayers.map((player) => <option key={player.id} value={player.id}>{player.organisation.name} · {player.zone.location.name} · {player.name}</option>)}
        </select>
      </label>
      <label style={styles.label}>Safe diagnostic
        <select value={kind} onChange={(event) => setKind(event.target.value)} style={styles.input}>
          {COMMANDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="button" disabled={!playerId || Boolean(busy)} onClick={requestCommand} style={styles.primary}>{busy === "command" ? "Queuing…" : "Queue diagnostic"}</button>
    </div>

    {canManageLifecycle && selected ? <div style={styles.lifecycle}>
      <h3 style={styles.subheading}>Revoke or replace this device</h3>
      <p style={styles.muted}>This immediately invalidates the old player session. A replacement keeps the same organisation and zone while preserving the old device’s incidents and proof history.</p>
      <div style={styles.controls}>
        <label style={styles.label}>Operational reason
          <input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Example: device retired after hardware failure" style={styles.input} />
        </label>
        <label style={styles.label}>Replacement name (optional)
          <input value={replacementName} maxLength={120} onChange={(event) => setReplacementName(event.target.value)} placeholder={`${selected.name} replacement`} style={styles.input} />
        </label>
      </div>
      <div style={styles.actions}>
        <button type="button" disabled={note.trim().length < 3 || Boolean(busy)} onClick={() => lifecycle("REVOKE_SESSION")} style={styles.danger}>Revoke and disable</button>
        <button type="button" disabled={note.trim().length < 3 || Boolean(busy)} onClick={() => lifecycle("CREATE_REPLACEMENT")} style={styles.primary}>Revoke and create replacement</button>
      </div>
    </div> : null}

    {error ? <p style={styles.error}>{error}</p> : null}
    {result ? <div style={styles.success}><strong>{result.message}</strong>{result.replacement ? <><code style={styles.code}>{result.replacement.enrolmentCode}</code><span>Enter this one-time code at <b>/player</b>. It is shown only here and expires after 24 hours.</span></> : null}</div> : null}

    <h3 style={styles.subheading}>Recent command evidence</h3>
    {report.commands.length === 0 ? <p style={styles.muted}>No player diagnostics have been requested.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}>
      <thead><tr><th style={styles.th}>Player</th><th style={styles.th}>Command</th><th style={styles.th}>Status</th><th style={styles.th}>Requested</th><th style={styles.th}>Result</th><th style={styles.th}></th></tr></thead>
      <tbody>{report.commands.slice(0, 25).map((command) => <tr key={command.id}>
        <td style={styles.tdStrong}>{command.player.name}<small style={styles.small}>{command.organisation.name}</small></td>
        <td style={styles.td}>{command.kind.replaceAll("_", " ")}</td>
        <td style={styles.td}><span style={styles.badge}>{command.status}</span></td>
        <td style={styles.td}>{new Date(command.requestedAt).toLocaleString()}</td>
        <td style={styles.td}>{command.resultCode || "Waiting"}{command.resultMessage ? <small style={styles.small}>{command.resultMessage}</small> : null}</td>
        <td style={styles.td}>{["PENDING", "DELIVERED"].includes(command.status) ? <button type="button" disabled={Boolean(busy)} onClick={() => cancel(command.id)} style={styles.secondary}>{busy === `cancel:${command.id}` ? "Cancelling…" : "Cancel"}</button> : null}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

const styles = {
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff" },
  header: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "start", flexWrap: "wrap" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.3 },
  title: { margin: 0, fontSize: 24, color: "#0f172a" },
  muted: { color: "#475569", lineHeight: 1.55, maxWidth: 860 },
  controls: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "end", marginTop: 18 },
  label: { display: "grid", gap: 7, color: "#334155", fontWeight: 800, fontSize: 14 },
  input: { minHeight: 42, border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 10px", background: "#fff", color: "#0f172a" },
  primary: { minHeight: 42, border: 0, borderRadius: 7, padding: "9px 14px", background: "#0f172a", color: "#fff", fontWeight: 800, cursor: "pointer" },
  secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "8px 12px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" },
  danger: { minHeight: 42, border: "1px solid #dc2626", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#b91c1c", fontWeight: 800, cursor: "pointer" },
  lifecycle: { marginTop: 24, padding: 16, border: "1px solid #fca5a5", borderRadius: 10, background: "#fff7f7" },
  actions: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },
  subheading: { margin: "24px 0 10px", color: "#0f172a", fontSize: 18 },
  error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 },
  success: { marginTop: 16, display: "grid", gap: 10, border: "1px solid #86efac", background: "#f0fdf4", padding: 16, borderRadius: 9, color: "#14532d" },
  code: { display: "block", overflowWrap: "anywhere", background: "#dcfce7", padding: 10, borderRadius: 6, fontSize: 14 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
  th: { padding: 9, textAlign: "left", borderBottom: "2px solid #cbd5e1", color: "#475569", fontSize: 12 },
  td: { padding: 9, borderBottom: "1px solid #e2e8f0", color: "#334155", verticalAlign: "top" },
  tdStrong: { padding: 9, borderBottom: "1px solid #e2e8f0", fontWeight: 800, verticalAlign: "top" },
  small: { display: "block", marginTop: 4, color: "#64748b", fontWeight: 500 },
  badge: { display: "inline-block", padding: "4px 7px", borderRadius: 999, background: "#e2e8f0", color: "#334155", fontSize: 11, fontWeight: 900 }
};
