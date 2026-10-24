"use client";

import { useEffect, useRef, useState } from "react";
import { TEST_RADIO_PLANNER_STATION_ID } from "@/lib/test-radio-weekly-planner-ui.mjs";
import { testRadioNowNextView } from "@/lib/test-radio-now-next-ui.mjs";
import styles from "@/app/admin/stations/[stationId]/setup/test-radio-planner.module.css";

export function TestRadioNowNextCards({ view }) {
  const time = value => new Date(value).toLocaleString("en-GB", { timeZone: view.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return <>
    <div className={styles.nowNextGrid}>
      <section className={styles.statusCard} aria-label="Now: source report"><p className={styles.sectionLabel}>Now · source report</p><h4>{view.label}</h4>
        {view.track ? <p><strong>{view.track.title}</strong><br />{view.track.artist}</p> : <p className={styles.hint}>No current song is confirmed by this snapshot. AutoDJ may still be running.</p>}
        <small className={styles.hint}>A worker report is not proof that a listener heard the audio.</small>
      </section>
      <section className={styles.statusCard} aria-label="Next: approved plan"><p className={styles.sectionLabel}>Next · approved plan</p>
        {view.next ? <><h4>{view.next.label}</h4><p><strong>{time(view.next.startsAt)}</strong>{view.next.endsAt ? ` → ${time(view.next.endsAt)}` : ""}</p><p className={styles.hint}>{view.next.kind === "RANDOM" ? "Planned return to random AutoDJ." : "Planned exact-time takeover."} This is not a confirmed handover or a fixed next song.</p></> : <p>{view.planMessage}</p>}
      </section>
    </div>
    <p className={styles.hint}>{view.checkedAt ? `Checked ${time(view.checkedAt)} · ${view.timezone}.` : "No recent status check."} Source reports expire after at most 15 seconds. Refresh is read-only and keeps your unsaved draft.</p>
    {view.warnings.map((warning, index) => <p key={index} className={styles.notice} role="note">Approved-plan notice: {warning}</p>)}
  </>;
}

export default function TestRadioNowNext({ stationId, snapshot }) {
  const [current, setCurrent] = useState(snapshot), [elapsed, setElapsed] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const received = useRef(0), pending = useRef(null), sequence = useRef(0);
  useEffect(() => {
    sequence.current += 1; pending.current?.abort(); pending.current = null;
    setCurrent(snapshot); setElapsed(0); setError(""); setBusy(false); received.current = performance.now();
  }, [snapshot]);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.max(0, performance.now() - received.current)), 1000);
    return () => { clearInterval(timer); sequence.current += 1; pending.current?.abort(); };
  }, []);
  if (stationId !== TEST_RADIO_PLANNER_STATION_ID) return null;
  async function refresh() {
    if (pending.current) return;
    const read = ++sequence.current, controller = new AbortController(), started = performance.now(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/programming/test-radio/schedule", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok || body.stationId !== stationId || body.nowNext?.stationId !== stationId) throw new Error("Status could not be verified. Your draft and the live stream have not been changed.");
      if (read === sequence.current) { setCurrent({ ...body.nowNext, requestAgeMs: performance.now() - started }); received.current = performance.now(); setElapsed(0); }
    } catch { if (read === sequence.current) { setCurrent(null); setError("Status is unavailable. Try again; AutoDJ may still be running. Your unsaved draft is unchanged."); } }
    finally { clearTimeout(timeout); if (read === sequence.current) { pending.current = null; setBusy(false); } }
  }
  const view = testRadioNowNextView(current, elapsed, Boolean(error));
  return <section className={styles.nowNext} aria-labelledby="test-radio-now-next-title">
    <div className={styles.toolbar}><h3 id="test-radio-now-next-title">Test Radio · Now &amp; Next</h3><button type="button" disabled={busy} onClick={refresh}>{busy ? "Checking…" : "Refresh Now & Next"}</button></div>
    <p className={styles.hint}>Read-only station status. Nothing here starts, stops or publishes audio. Your draft and approval status are shown in the weekly planner below.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div aria-live="polite"><TestRadioNowNextCards view={view} /></div>
  </section>;
}
