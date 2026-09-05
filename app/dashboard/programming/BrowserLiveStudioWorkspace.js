"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./programming.module.css";

const localInput = (date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};
const initialForm = () => ({ title: "Live show", channelId: "", djAccessGrantId: "", scheduledStart: localInput(new Date(Date.now() + 10 * 60_000)), scheduledEnd: localInput(new Date(Date.now() + 70 * 60_000)), recordEnabled: false, retentionApproved: false });
const stateLabel = (value) => ({ CREATED: "Scheduled", SOUNDCHECK: "Soundcheck", READY: "Ready", ON_AIR: "On air", FALLBACK: "Fallback active", ENDED: "Ended" }[value] || value);

export default function BrowserLiveStudioWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/browser-live-studio", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load Browser Live Studio.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const grants = useMemo(() => (data?.grants || []).filter((grant) => !form.channelId || grant.channelId === form.channelId), [data, form.channelId]);
  const selectedGrant = grants.find((grant) => grant.id === form.djAccessGrantId);

  async function request(body, success) {
    setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/browser-live-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The Browser Live Studio action failed.");
      setNotice(success); await load();
      return true;
    } catch (requestError) { setError(requestError.message); return false; } finally { setBusy(""); }
  }

  async function create(event) {
    event.preventDefault();
    const created = await request({ action: "CREATE", ...form, scheduledStart: new Date(form.scheduledStart).toISOString(), scheduledEnd: new Date(form.scheduledEnd).toISOString() }, "Studio session scheduled. Send the existing private DJ link to the named presenter.");
    if (created) setForm(initialForm());
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading Browser Live Studio…</div></section>;
  const sessions = data?.sessions || [];
  const open = sessions.filter((session) => !["ENDED", "FALLBACK"].includes(session.status));
  return <section className={styles.panel} aria-labelledby="browser-live-studio-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>BROWSER LIVE STUDIO</p><h2 id="browser-live-studio-title">Broadcast safely from the browser</h2></div><span className={styles.count}>{open.length} open</span></div>
    <p className={styles.panelIntro}>Schedule a named presenter, run a local microphone soundcheck and publish through a provider-neutral WHIP/WebRTC connection. Live audio enters the existing External Live, failover and unified playout path.</p>
    <div className={data?.providerConfigured ? styles.studioProviderReady : styles.studioProviderNeeded}><strong>{data?.providerConfigured ? "Real-time provider ready" : "Real-time provider setup required"}</strong><span>{data?.providerConfigured ? "Presenters can prepare an encrypted, time-bounded publishing connection after a good soundcheck." : "Scheduling and local soundcheck are available, but Ruvanas will not offer a Go live control until a compatible media provider is configured."}</span></div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {sessions.length ? <div className={styles.browserStudioGrid}>{sessions.map((session) => <article className={styles.browserStudioCard} key={session.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{session.title}</strong><span>{session.channel?.station?.name ? `${session.channel.station.name} / ` : ""}{session.channel?.name}</span></div><span className={session.status === "ON_AIR" ? styles.liveSourceBadge : session.status === "FALLBACK" ? styles.healthWarning : styles.draftBadge}>{stateLabel(session.status)}</span></div>
      <p>{session.presenter?.name || session.presenter?.email || "Assigned presenter"} · {new Date(session.scheduledStart).toLocaleString()}–{new Date(session.scheduledEnd).toLocaleTimeString()}</p>
      <div className={styles.liveSourceMeta}><span>{data.protocol}</span><span>{session.connectionQuality.toLowerCase()} soundcheck</span><span>{session.recordEnabled ? "Recording approved" : "No recording"}</span><span>v{session.sessionVersion}</span></div>
      {session.lastHeartbeatAt ? <small>Last studio heartbeat {new Date(session.lastHeartbeatAt).toLocaleString()}</small> : <small>Presenter has not joined yet.</small>}
      {data.canManage && !["ENDED", "FALLBACK"].includes(session.status) ? <div className={styles.cardActions}>
        {["SOUNDCHECK", "READY", "ON_AIR"].includes(session.status) ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => request({ action: "FORCE_FALLBACK", sessionId: session.id, expectedVersion: session.sessionVersion, reason: "Fallback activated by the organisation manager." }, "Fallback activated; shared schedule or AutoDJ resumes.")}>Activate fallback</button> : null}
        <button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => request({ action: "END", sessionId: session.id, expectedVersion: session.sessionVersion, reason: "Studio session ended by the organisation manager." }, "Studio session ended safely.")}>End session</button>
      </div> : null}
    </article>)}</div> : <div className={styles.emptyState}>No Browser Live Studio sessions have been scheduled.</div>}
    {data?.canManage ? <form className={styles.schedulerForm} onSubmit={create}>
      <div className={styles.smartFormHeader}><div><h3>Schedule a browser studio</h3><p>The presenter must already have an active, channel-scoped DJ grant with Browser Live Studio permission.</p></div></div>
      <div className={styles.formGrid}>
        <label><span>Show title</span><input required minLength="2" maxLength="180" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label><span>Channel</span><select required value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value, djAccessGrantId: "" })}><option value="">Choose channel</option>{(data.channels || []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <label><span>Presenter access</span><select required value={form.djAccessGrantId} onChange={(event) => setForm({ ...form, djAccessGrantId: event.target.value, recordEnabled: false, retentionApproved: false })}><option value="">Choose eligible presenter</option>{grants.map((grant) => <option key={grant.id} value={grant.id}>{grant.presenter?.name || grant.presenter?.email} · {grant.label}</option>)}</select></label>
        <label><span>Starts</span><input required type="datetime-local" value={form.scheduledStart} onChange={(event) => setForm({ ...form, scheduledStart: event.target.value })} /></label>
        <label><span>Ends</span><input required type="datetime-local" value={form.scheduledEnd} onChange={(event) => setForm({ ...form, scheduledEnd: event.target.value })} /></label>
        <label className={styles.switchField}><span>Recording</span><span className={styles.switchRow}><input type="checkbox" disabled={!selectedGrant?.canRecord} checked={form.recordEnabled} onChange={(event) => setForm({ ...form, recordEnabled: event.target.checked, retentionApproved: event.target.checked ? form.retentionApproved : false })} /><strong>{selectedGrant?.canRecord ? "Allow this session" : "Not included in presenter access"}</strong></span></label>
        {form.recordEnabled ? <label className={styles.switchField}><span>Retention approval</span><span className={styles.switchRow}><input type="checkbox" required checked={form.retentionApproved} onChange={(event) => setForm({ ...form, retentionApproved: event.target.checked })} /><strong>Approved for governed storage</strong></span></label> : null}
      </div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Named identity · one channel · bounded window · automatic fallback</span><button className={styles.primaryButton} disabled={busy !== "" || !selectedGrant}>{busy ? "Scheduling…" : "Schedule studio"}</button></div>
    </form> : null}
  </section>;
}
