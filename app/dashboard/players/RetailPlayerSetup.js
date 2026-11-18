"use client";

import { retailPlayerGuidance, retailPlayerStatusLabel } from "@/lib/retail-player-guidance.mjs";
import styles from "./retail-player-setup.module.css";

export default function RetailPlayerSetup({ players, activePlayers, zones, canManage, configured, limit, form, setForm, setupAccessEnabled = true,
  replacement, setReplacement, busy, error, enrolment, refreshing, refreshReadiness, createPlayer, replacePlayer, copyEnrolmentCode }) {
  const next = retailPlayerGuidance({ players, hasZones: zones.length > 0, canManage, setupAccessEnabled });
  const createForm = <form onSubmit={createPlayer} className={styles.form}>
    <label>Shop and listening area
      <select value={form.zoneId} onChange={event => setForm({ ...form, zoneId: event.target.value })}>
        {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.locationName} — {zone.name}</option>)}
      </select>
    </label>
    <label>Device name
      <input value={form.name} maxLength={120} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="For example, Main shop tablet" />
    </label>
    <button className={styles.primary} disabled={busy || configured >= limit || !form.zoneId || form.name.trim().length < 2}>{busy === "create" ? "Preparing…" : "Get connection code"}</button>
    {configured >= limit && <p className={styles.notice}>All {limit} device places in your current plan are in use. Device replacement is available below.</p>}
  </form>;

  return <div className={styles.layout}>
    <section className={styles.everyday} aria-labelledby="retail-everyday-title">
      <div><p className={styles.eyebrow}>EVERYDAY RETAIL RADIO</p><h2 id="retail-everyday-title">Just want to listen or plan?</h2>
        <p>You do not need to set up a shop device to use these tools.</p></div>
      <nav className={styles.shortcuts} aria-label="Retail everyday tasks">
        <a className={styles.primary} href="/dashboard/listen/retail" target="_blank" rel="noreferrer">▶ Listen now</a>
        <a className={styles.secondary} href="/dashboard/programming#workspace-simple">Choose music</a>
        <a className={styles.secondary} href="/dashboard/programming#workspace-planner">Plan the week</a>
        <a className={styles.secondary} href="/dashboard/programming#workspace-commercials">Manage commercials</a>
      </nav>
    </section>

    <section className={styles.next} aria-labelledby="retail-device-next-title">
      <div className={styles.cardHeader}><p className={styles.eyebrow}>SHOP DEVICE SETUP</p><span className={styles.allowance}>{configured} of {limit} devices</span></div>
      <h2 id="retail-device-next-title">{enrolment ? "Connect this device in your shop" : next.title}</h2>
      {!enrolment && <p>{next.playerName ? <strong>{next.playerName}. </strong> : null}{next.detail}</p>}
      {!enrolment && next.kind === "ADD_SHOP" && <a className={styles.primary} href="/dashboard/locations?returnTo=players">Add a shop</a>}
      {!enrolment && next.kind === "CREATE_PLAYER" && createForm}
      {!enrolment && next.kind === "CHECK_PLAYER" && <p className={styles.subtle}>Connection details are below. This does not stop your shared Retail stream.</p>}
      {enrolment && <div className={styles.connection} aria-live="polite">
        <p>On the device that will stay in the shop, open the player and enter this one-time code for <strong>{enrolment.name}</strong>.</p>
        <code>{enrolment.enrolmentCode}</code>
        <div className={styles.shortcuts}><button type="button" className={styles.secondary} onClick={copyEnrolmentCode}>Copy code</button><a className={styles.primary} href="/player" target="_blank" rel="noreferrer">Open shop player</a></div>
        <p className={styles.subtle}>The code expires {new Date(enrolment.enrolmentExpiresAt).toLocaleString()}. Use it only on that shop device.</p>
        <p>Allow audio and press play. Keep the player open; this page checks its status every 15 seconds.</p>
      </div>}
    </section>

    {error && <p className={styles.error} role="alert">{error}</p>}

    {players.length > 0 && <section className={styles.card} aria-labelledby="retail-shop-devices-title">
      <div className={styles.cardHeader}><h2 id="retail-shop-devices-title">Your shop devices</h2><button type="button" className={styles.secondary} onClick={() => refreshReadiness()} disabled={refreshing}>{refreshing ? "Checking…" : "Check status"}</button></div>
      <div className={styles.players}>{players.map(player => <article className={styles.player} key={player.id}>
        <div className={styles.cardHeader}><div><h3>{player.name}</h3><p>{player.locationName} · {player.zoneName}</p></div><span className={`${styles.badge} ${player.readiness?.ready ? styles.ready : styles.waiting}`}>{retailPlayerStatusLabel(player.readiness)}</span></div>
        <p>{player.readiness?.summary || "Device status has not been confirmed."}</p>
        <details className={styles.details}><summary>Connection details</summary>
          <ul className={styles.checks}>{(player.readiness?.checklist || []).map(item => <li key={item.key}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div></li>)}</ul>
          <p className={styles.subtle}>Last device contact: {player.readiness?.lastHeartbeatAt ? new Date(player.readiness.lastHeartbeatAt).toLocaleString() : "Not yet"} · {player.readiness?.playbackEvidence === "DEVICE_REPORTED_STREAM_ONLY" ? "Latest stream report" : "Last playback"}: {player.readiness?.lastPlaybackAt ? new Date(player.readiness.lastPlaybackAt).toLocaleString() : "Not yet"}</p>
        </details>
      </article>)}</div>
    </section>}

    <details className={styles.advanced}>
      <summary>More device options and help</summary>
      <p>Each shop player uses one device place in your existing plan. Status comes from the connected device and its recent audio reports. A stream playback report does not verify the shop's speakers or individual song delivery.</p>
      {canManage && activePlayers.length > 0 && zones.length > 0 && <details className={styles.details}><summary>Connect another shop device</summary>{createForm}</details>}
      {canManage && activePlayers.length > 0 && <details className={styles.details}>
        <summary>Replace an existing device</summary>
        <p className={styles.notice}>Replacing immediately stops the selected device. It creates a new connection code for the same listening area.</p>
        <form onSubmit={replacePlayer} className={styles.form}>
          <label>Device to replace<select value={replacement.playerId} onChange={event => setReplacement({ ...replacement, playerId: event.target.value })}><option value="">Choose a device</option>{activePlayers.map(player => <option key={player.id} value={player.id}>{player.locationName} — {player.name}</option>)}</select></label>
          <label>New device name (optional)<input value={replacement.replacementName} maxLength={120} onChange={event => setReplacement({ ...replacement, replacementName: event.target.value })} /></label>
          <label>Reason<input value={replacement.note} maxLength={2000} onChange={event => setReplacement({ ...replacement, note: event.target.value })} placeholder="For example, shop tablet replaced" /></label>
          <label className={styles.confirm}><input type="checkbox" checked={replacement.confirmed} onChange={event => setReplacement({ ...replacement, confirmed: event.target.checked })} />I understand the current device will stop immediately.</label>
          <button className={styles.danger} disabled={busy || !replacement.playerId || replacement.note.trim().length < 3 || !replacement.confirmed}>{busy === "replace" ? "Replacing…" : "Stop and replace this device"}</button>
        </form>
      </details>}
      <a className={styles.helpLink} href="/dashboard/help#shop-players">Read the shop player guide</a>
    </details>
  </div>;
}
