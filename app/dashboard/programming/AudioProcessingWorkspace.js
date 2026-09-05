"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./programming.module.css";

const EMPTY = { name: "", purpose: "", codec: "MP3", bitrateKbps: 192, sampleRateHz: 48000, targetLufs: -16, truePeakDbfs: -1.5, maxLoudnessRangeLu: 12, highpassHz: 30, lowpassHz: 18000, compressionThresholdDb: -18, compressionRatio: 2.5, compressionAttackMs: 20, compressionReleaseMs: 250, limiterEnabled: true };
const qcClass = (status) => status === "PASSED" ? styles.publishedBadge : status === "FAILED" ? styles.healthWarning : styles.draftBadge;

export default function AudioProcessingWorkspace() {
  const [data, setData] = useState(null);
  const [profile, setProfile] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [sourceRenderId, setSourceRenderId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError("");
    try {
      const response = await fetch("/api/programming/audio-processing", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load broadcast processing.");
      setData(payload);
    } catch (loadError) { if (!quiet) setError(loadError.message); } finally { if (!quiet) setBusy(""); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const hasPending = useMemo(() => (data?.outputs || []).some((item) => ["QUEUED", "RUNNING"].includes(item.status)), [data]);
  useEffect(() => { if (!hasPending) return undefined; const timer = setInterval(() => load(true), 5000); return () => clearInterval(timer); }, [hasPending, load]);

  function template(key) { setEditing(null); setProfile({ ...EMPTY, ...(data?.templates?.[key] || {}) }); }
  function edit(item) { setEditing(item); setProfile({ ...EMPTY, ...item }); setError(""); setNotice(""); }
  function reset() { setEditing(null); setProfile(EMPTY); }
  function field(name, value) { setProfile((current) => ({ ...current, [name]: value })); }

  async function saveProfile(event) {
    event.preventDefault(); setBusy("profile"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/audio-processing", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { action: "UPDATE_PROFILE", profileId: editing.id, expectedVersion: editing.version, profile } : { action: "CREATE_PROFILE", profile }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the processing profile.");
      setNotice(editing ? "Draft processing profile updated." : "Draft profile created. Review its targets, then activate it for processing.");
      reset(); await load(true);
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function profileAction(item, action) {
    setBusy(`${action}:${item.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/audio-processing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, profileId: item.id, expectedVersion: item.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to change the processing profile.");
      setNotice(action === "ACTIVATE" ? "Profile activated. It can now create measured broadcast outputs." : "Profile archived without deleting its prior outputs.");
      await load(true);
    } catch (actionError) { setError(actionError.message); } finally { setBusy(""); }
  }

  async function queue(event) {
    event.preventDefault(); setBusy("queue"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/audio-processing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "QUEUE_PROCESSING", profileId, sourceRenderId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to queue broadcast processing.");
      setNotice(payload.created ? "Broadcast processing queued on the protected audio worker." : "This exact source and profile revision is already queued or complete; the existing result was reused.");
      await load(true);
    } catch (queueError) { setError(queueError.message); } finally { setBusy(""); }
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading broadcast audio processing…</div></section>;
  const activeProfiles = (data?.profiles || []).filter((item) => item.status === "ACTIVE");
  return <section className={styles.panel} aria-labelledby="audio-processing-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>BROADCAST AUDIO PROCESSING</p><h2 id="audio-processing-title">Consistent sound on every output</h2></div><span className={styles.count}>{activeProfiles.length} active</span></div>
    <p className={styles.panelIntro}>Apply a reviewed loudness, true-peak, tone and compression profile through the existing protected audio worker. Every output keeps its exact profile revision and measured quality result.</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}

    {(data?.profiles || []).length ? <div className={styles.voiceTrackGrid}>{data.profiles.map((item) => <article className={styles.voiceTrackCard} key={item.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{item.name}</strong><span>{item.purpose || "Broadcast processing profile"}</span></div><span className={item.status === "ACTIVE" ? styles.publishedBadge : styles.draftBadge}>{item.status}</span></div>
      <p>{item.targetLufs} LUFS · {item.truePeakDbfs} dBTP · {item.codec === "WAV" ? "24-bit WAV" : `${item.codec} ${item.bitrateKbps} kbps`} · {item.sampleRateHz / 1000} kHz</p>
      <p>Filter {item.highpassHz}–{item.lowpassHz} Hz · compressor {item.compressionRatio}:1 · revision {item.version}</p>
      {data.canManageProfiles ? <div className={styles.cardActions}>{item.status === "DRAFT" ? <><button type="button" className={styles.secondaryButton} onClick={() => edit(item)}>Edit profile</button><button type="button" className={styles.primaryButton} disabled={busy !== ""} onClick={() => profileAction(item, "ACTIVATE")}>Activate</button></> : null}<button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => profileAction(item, "ARCHIVE")}>Archive</button></div> : null}
    </article>)}</div> : <div className={styles.emptyState}>No broadcast profiles yet. Start with a safe template and review it before activation.</div>}

    {data?.canManageProfiles ? <form className={styles.smartPlaylistForm} onSubmit={saveProfile}>
      <div className={styles.smartFormHeader}><div><h3>{editing ? "Edit draft processing profile" : "Create a processing profile"}</h3><p>Templates are editable starting points. Activation is a separate owner or manager decision.</p></div>{editing ? <button type="button" className={styles.secondaryButton} onClick={reset}>Create another</button> : null}</div>
      <div className={styles.cardActions}><button type="button" className={styles.secondaryButton} onClick={() => template("WEB_RADIO")}>Web Radio template</button><button type="button" className={styles.secondaryButton} onClick={() => template("TALK_RADIO")}>Talk Radio template</button><button type="button" className={styles.secondaryButton} onClick={() => template("ARCHIVE_MASTER")}>Archive Master template</button></div>
      <div className={styles.formGrid}>
        <label><span>Profile name</span><input required minLength="2" maxLength="120" value={profile.name} onChange={(event) => field("name", event.target.value)} /></label>
        <label><span>Purpose</span><input maxLength="500" value={profile.purpose || ""} onChange={(event) => field("purpose", event.target.value)} /></label>
        <label><span>Output</span><select value={profile.codec} onChange={(event) => field("codec", event.target.value)}><option value="MP3">MP3</option><option value="AAC">AAC</option><option value="WAV">24-bit WAV</option></select></label>
        <label><span>Bitrate</span><select disabled={profile.codec === "WAV"} value={profile.bitrateKbps} onChange={(event) => field("bitrateKbps", Number(event.target.value))}>{[64,96,128,160,192,256,320].map((value) => <option value={value} key={value}>{value} kbps</option>)}</select></label>
        <label><span>Sample rate</span><select value={profile.sampleRateHz} onChange={(event) => field("sampleRateHz", Number(event.target.value))}><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option></select></label>
        <label><span>Target loudness (LUFS)</span><input type="number" min="-24" max="-9" step="0.5" value={profile.targetLufs} onChange={(event) => field("targetLufs", Number(event.target.value))} /></label>
        <label><span>True-peak ceiling (dBTP)</span><input type="number" min="-3" max="-0.5" step="0.1" value={profile.truePeakDbfs} onChange={(event) => field("truePeakDbfs", Number(event.target.value))} /></label>
        <label><span>Maximum loudness range (LU)</span><input type="number" min="1" max="20" step="0.5" value={profile.maxLoudnessRangeLu} onChange={(event) => field("maxLoudnessRangeLu", Number(event.target.value))} /></label>
        <label><span>High-pass / low-pass (Hz)</span><span className={styles.inlineInputs}><input type="number" min="20" max="200" value={profile.highpassHz} onChange={(event) => field("highpassHz", Number(event.target.value))} /><input type="number" min="8000" max="20000" value={profile.lowpassHz} onChange={(event) => field("lowpassHz", Number(event.target.value))} /></span></label>
        <label><span>Compressor threshold / ratio</span><span className={styles.inlineInputs}><input type="number" min="-40" max="-6" step="0.5" value={profile.compressionThresholdDb} onChange={(event) => field("compressionThresholdDb", Number(event.target.value))} /><input type="number" min="1" max="10" step="0.1" value={profile.compressionRatio} onChange={(event) => field("compressionRatio", Number(event.target.value))} /></span></label>
        <label><span>Attack / release (ms)</span><span className={styles.inlineInputs}><input type="number" min="1" max="200" value={profile.compressionAttackMs} onChange={(event) => field("compressionAttackMs", Number(event.target.value))} /><input type="number" min="20" max="2000" value={profile.compressionReleaseMs} onChange={(event) => field("compressionReleaseMs", Number(event.target.value))} /></span></label>
        <label><span>Safety limiter</span><select value={profile.limiterEnabled ? "ON" : "OFF"} onChange={(event) => field("limiterEnabled", event.target.value === "ON")}><option value="ON">Enabled</option><option value="OFF">Disabled</option></select></label>
      </div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Versioned profile · protected worker · measured loudness and peak · no live change</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy === "profile" ? "Saving…" : editing ? "Save new revision" : "Create draft profile"}</button></div>
    </form> : null}

    {data?.canProcess ? <form className={styles.smartPlaylistForm} onSubmit={queue}>
      <div className={styles.smartFormHeader}><div><h3>Create a broadcast-ready output</h3><p>The original project and render remain unchanged. Repeating the same source and profile revision safely reuses the existing job.</p></div></div>
      <div className={styles.formGrid}>
        <label><span>Completed source render</span><select required value={sourceRenderId} onChange={(event) => setSourceRenderId(event.target.value)}><option value="">Choose source</option>{(data.sourceRenders || []).map((item) => <option value={item.id} key={item.id}>{item.projectTitle} · {item.projectType}</option>)}</select></label>
        <label><span>Active processing profile</span><select required value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Choose active profile</option>{activeProfiles.map((item) => <option value={item.id} key={item.id}>{item.name} · rev {item.version}</option>)}</select></label>
      </div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Immutable source · duplicate-safe request · automatic QC</span><button className={styles.primaryButton} disabled={busy !== "" || !sourceRenderId || !profileId}>{busy === "queue" ? "Queuing…" : "Queue protected processing"}</button></div>
    </form> : null}

    {(data?.outputs || []).length ? <div className={styles.voiceTrackGrid}>{data.outputs.map((item) => <article className={styles.voiceTrackCard} key={item.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{item.projectTitle}</strong><span>{item.profile?.name || "Processing profile"} · revision {item.profileRevision}</span></div><span className={qcClass(item.qcStatus)}>{item.status === "SUCCEEDED" ? item.qcStatus : item.status}</span></div>
      <p>{item.loudnessLufs == null ? "Loudness pending" : `${Number(item.loudnessLufs).toFixed(1)} LUFS`} · {item.truePeakDbfs == null ? "peak pending" : `${Number(item.truePeakDbfs).toFixed(1)} dBFS`} · {item.loudnessRangeLu == null ? "range pending" : `${Number(item.loudnessRangeLu).toFixed(1)} LU range`}</p>
      {item.qcNotes ? <p>{item.qcNotes}</p> : null}
      {item.streamUrl ? <audio controls preload="none" src={item.streamUrl}>Your browser does not support protected audio playback.</audio> : null}
    </article>)}</div> : null}
  </section>;
}
