"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function PlayerSetupClient({ players, zones, canManage, configured, limit }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", zoneId: zones[0]?.id || "" });
  const [replacement, setReplacement] = useState({ playerId: "", note: "", replacementName: "", confirmed: false });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [enrolment, setEnrolment] = useState(null);
  const activePlayers = useMemo(() => players.filter((player) => player.status !== "DISABLED"), [players]);

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
        body: JSON.stringify({
          note: replacement.note,
          replacementName: replacement.replacementName,
          confirmReplacement: replacement.confirmed
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to replace the shop player.");
      setEnrolment(data.replacement);
      setReplacement({ playerId: "", note: "", replacementName: "", confirmed: false });
      router.refresh();
    } catch (actionError) {
      setError(actionError.message || "Unable to replace the shop player.");
    } finally { setBusy(""); }
  }

  return <>
    <section style={styles.summary}>
      <div><span style={styles.label}>Configured players</span><strong>{configured} / {limit}</strong></div>
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
        <button disabled={busy || configured >= limit || !form.zoneId || form.name.trim().length < 2} style={styles.primary}>{busy === "create" ? "Preparing…" : "Create enrolment"}</button>
      </form>
      {configured >= limit ? <p style={styles.warning}>Your configured player allowance is full. Replace an existing player to move a shop to new hardware.</p> : null}
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
    {enrolment ? <section style={styles.success}>
      <strong>One-time enrolment code for {enrolment.name}</strong>
      <code style={styles.code}>{enrolment.enrolmentCode}</code>
      <span>Open <b>/player</b> on the shop device and enter this code. It is shown only here and expires after 24 hours.</span>
    </section> : null}

    <section style={styles.card}>
      <h2 style={styles.title}>Your shop players</h2>
      {!players.length ? <p style={styles.copy}>No shop players have been configured.</p> : <div style={styles.list}>{players.map((player) => <article key={player.id} style={styles.player}>
        <div><strong>{player.name}</strong><p style={styles.copy}>{player.locationName} / {player.zoneName}</p></div>
        <div><span style={styles.badge}>{player.status.replaceAll("_", " ")}</span><p style={styles.meta}>{player.lastHeartbeatAt ? `Last online ${new Date(player.lastHeartbeatAt).toLocaleString()}` : "Waiting for enrolment"}</p></div>
      </article>)}</div>}
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
  danger: { minHeight: 44, border: "1px solid #ef4444", borderRadius: 8, padding: "10px 15px", background: "#3d1820", color: "#fecaca", fontWeight: 900 },
  confirm: { display: "flex", alignItems: "center", gap: 9, color: "#fecaca", fontWeight: 800 },
  warning: { color: "#fde68a", fontWeight: 800 },
  error: { padding: 14, borderRadius: 10, background: "#481b24", color: "#fecaca", fontWeight: 800 },
  success: { marginTop: 18, display: "grid", gap: 10, border: "1px solid #4ade80", background: "#153c2d", padding: 18, borderRadius: 12, color: "#bbf7d0" },
  code: { padding: 12, borderRadius: 7, background: "#0f2e22", color: "#fff", overflowWrap: "anywhere" },
  list: { display: "grid", gap: 10, marginTop: 16 },
  player: { display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap", padding: 15, borderRadius: 10, background: "#111c2e", border: "1px solid #30405a" },
  badge: { display: "inline-block", padding: "5px 8px", borderRadius: 999, background: "#263852", color: "#dce5f2", fontSize: 11, fontWeight: 900 },
  meta: { color: "#91a2ba", fontSize: 12, margin: "7px 0 0" }
};
