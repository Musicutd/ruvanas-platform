"use client";

import { useEffect, useState } from "react";
import styles from "./access.module.css";

export default function DjAccessClient() {
  const [state, setState] = useState({ loading: true, error: "", session: null });
  useEffect(() => {
    let active = true;
    async function connect() {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
      const response = await fetch("/api/dj-access/session", token ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) } : { cache: "no-store" });
      const payload = await response.json();
      if (!active) return;
      if (response.ok) {
        if (token) history.replaceState(null, "", window.location.pathname);
        setState({ loading: false, error: "", session: payload.session });
      } else setState({ loading: false, error: payload.error || "DJ access is unavailable.", session: null });
    }
    connect().catch(() => active && setState({ loading: false, error: "DJ access could not be checked.", session: null }));
    return () => { active = false; };
  }, []);

  async function leave() {
    await fetch("/api/dj-access/session", { method: "DELETE" });
    setState({ loading: false, error: "DJ access has been removed from this browser.", session: null });
  }

  return <article className={styles.card}>
    <p className={styles.kicker}>PRESENTER ACCESS</p>
    <h1>{state.loading ? "Checking your private access…" : state.session ? state.session.label : "DJ access is not active"}</h1>
    {state.loading ? <p className={styles.body}>Ruvanas is validating the signed-in presenter, channel, access window and private link.</p> : state.error ? <><div className={styles.error}>{state.error}</div><p className={styles.body}>Sign in with the account named by your station manager, then reopen the original private link.</p><a className={styles.primary} href="/login">Sign in</a></> : <>
      <div className={styles.live}><span>ACCESS READY</span><strong>{state.session.channel?.station?.name ? `${state.session.channel.station.name} / ` : ""}{state.session.channel?.name}</strong></div>
      <dl className={styles.details}><div><dt>Starts</dt><dd>{new Date(state.session.startsAt).toLocaleString()}</dd></div><div><dt>Ends</dt><dd>{new Date(state.session.endsAt).toLocaleString()}</dd></div></dl>
      <div className={styles.permissions}><strong>Approved permissions</strong>{state.session.capabilities.map((capability) => <span key={capability}>✓ {capability.replaceAll("_", " ").toLowerCase()}</span>)}</div>
      <p className={styles.body}>Your identity and access window are ready. Every live control remains limited to this presenter, channel and approved time window.</p>
      <div className={styles.actions}>{state.session.capabilities.includes("START_BROWSER_STUDIO") ? <a className={styles.primary} href="/dj/studio">Open Browser Live Studio</a> : null}<a className={styles.primary} href="/dashboard/programming">Open programming</a><button type="button" onClick={leave}>Remove access from browser</button></div>
    </>}
  </article>;
}

