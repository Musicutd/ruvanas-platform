"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./programming.module.css";

const tomorrow = () => { const date = new Date(Date.now() + 86400000); return date.toISOString().slice(0, 10); };
const initialTimed = { name: "Timed music block", targetKey: "", scheduledDate: tomorrow(), startTime: "10:00", endTime: "14:00", sourceScopes: ["SUBSCRIBER_LIBRARY"], selectedGenreCodes: [] };
const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const duration = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const itemTime = (playlist, seconds) => { const total = playlist.startMinute * 60 + seconds; return `${clock(Math.floor(total / 60) % 1440)}:${String(total % 60).padStart(2, "0")}`; };

function ChoiceChips({ items, values, onChange, disabledFor }) {
  return <div className={styles.autodjChips}>{items.map((item) => { const selected = values.includes(item.code); const disabled = disabledFor ? disabledFor(item) : item.enabled === false; return <label className={`${styles.autodjChip} ${selected ? styles.autodjChipSelected : ""} ${disabled ? styles.autodjChipLocked : ""}`} key={item.code}><input type="checkbox" disabled={disabled} checked={selected} onChange={() => onChange(selected ? values.filter((value) => value !== item.code) : [...values, item.code])} /><span>{item.label}</span>{disabled ? <small>{item.minimumLevel ? `Tier ${item.minimumLevel.toLowerCase()}` : "Unavailable"}</small> : null}</label>; })}</div>;
}

export default function AutoDjExpansionWorkspace() {
  const [mode, setMode] = useState("CONTINUOUS");
  const [data, setData] = useState(null);
  const [programming, setProgramming] = useState(null);
  const [timed, setTimed] = useState(initialTimed);
  const [continuous, setContinuous] = useState({ targetKey: "", enabled: true, state: "ACTIVE", defaultMusicModeId: "", backupMusicModeId: "", playbackPolicy: "RUN_24_7", sourceScopes: ["SUBSCRIBER_LIBRARY"], selectedGenreCodes: [] });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [expansionResponse, programmingResponse] = await Promise.all([fetch("/api/programming/autodj-expansion", { cache: "no-store" }), fetch("/api/programming", { cache: "no-store" })]);
    const [expansion, radio] = await Promise.all([expansionResponse.json(), programmingResponse.json()]);
    if (!expansionResponse.ok) throw new Error(expansion.error || "Unable to load AutoDJ.");
    if (!programmingResponse.ok) throw new Error(radio.error || "Unable to load radio targets.");
    setData(expansion); setProgramming(radio);
    const firstTarget = expansion.targets[0];
    setTimed((value) => ({ ...value, targetKey: value.targetKey || (firstTarget ? `${firstTarget.type}:${firstTarget.id}` : "") }));
    setContinuous((value) => ({ ...value, targetKey: value.targetKey || (firstTarget ? `${firstTarget.type}:${firstTarget.id}` : ""), defaultMusicModeId: value.defaultMusicModeId || radio.musicModes.find((musicMode) => musicMode.playableTrackCount)?.id || "" }));
  }
  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, []);
  const selectedTarget = (key) => { const [type, id] = key.split(":"); return data?.targets.find((target) => target.type === type && target.id === id) || null; };
  const timedTarget = useMemo(() => selectedTarget(timed.targetKey), [data, timed.targetKey]);
  const continuousTarget = useMemo(() => selectedTarget(continuous.targetKey), [data, continuous.targetKey]);
  const licensedSelected = (form) => form.sourceScopes.includes("LICENSED_CATALOGUE");
  const genreItems = data?.genres || [];
  const playableModes = programming?.musicModes.filter((musicMode) => musicMode.playableTrackCount > 0) || [];

  function toggleScope(form, setter, scopes) {
    setter({ ...form, sourceScopes: scopes, selectedGenreCodes: scopes.includes("LICENSED_CATALOGUE") ? form.selectedGenreCodes.filter((code) => genreItems.find((genre) => genre.code === code)?.enabled) : form.selectedGenreCodes });
  }

  async function saveContinuous() {
    setBusy("continuous"); setError(""); setNotice("");
    try {
      if (!continuousTarget?.channelId) throw new Error("Choose a target connected to exactly one active radio channel.");
      const response = await fetch("/api/programming/autodj", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...continuous, channelId: continuousTarget.channelId, targetType: continuousTarget.type, targetId: continuousTarget.id, rightsUse: continuousTarget.rightsUse, territory: continuousTarget.territory, defaultMusicModeId: continuous.defaultMusicModeId || null, backupMusicModeId: continuous.backupMusicModeId || null }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to save Continuous AutoDJ.");
      setNotice(continuous.state === "PAUSED" ? "Continuous AutoDJ is paused. Its settings are preserved." : "Continuous AutoDJ is active. Higher-priority programming still takes precedence.");
      await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function generate() {
    setBusy("generate"); setError(""); setNotice("");
    try {
      if (!timedTarget) throw new Error("Choose a target.");
      const response = await fetch("/api/programming/autodj-expansion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...timed, targetType: timedTarget.type, targetId: timedTarget.id }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to generate the playlist.");
      setPreview(payload.playlist); setNotice("Draft generated. Review the running order before publishing."); await load();
    } catch (generateError) { setError(generateError.message); } finally { setBusy(""); }
  }

  async function action(actionName) {
    if (!preview) return; setBusy(actionName); setError(""); setNotice("");
    try {
      const endpoint = actionName === "publish" ? `/api/programming/autodj-expansion/${preview.id}/publish` : `/api/programming/autodj-expansion/${preview.id}`;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "REGENERATE" }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Unable to ${actionName} the playlist.`);
      setPreview(payload.playlist); setNotice(actionName === "publish" ? "The frozen sequence is published and scheduled." : "A new draft version was generated. The published version was not changed."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setBusy(""); }
  }

  if (!data || !programming) return <section className={styles.panel}><div className={error ? styles.error : styles.loading}>{error || "Loading the AutoDJ workspace…"}</div></section>;
  const form = mode === "CONTINUOUS" ? continuous : timed;
  const setForm = mode === "CONTINUOUS" ? setContinuous : setTimed;
  const version = preview?.versions.find((entry) => entry.version === preview.currentVersion);
  return <section className={styles.panel} aria-labelledby="autodj-expansion-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>AUTODJ</p><h2 id="autodj-expansion-title">Choose how you want music to run</h2></div><span className={styles.permission}>{data.catalogueLevel.toLowerCase()} catalogue</span></div>
    <p className={styles.panelIntro}>Use non-stop music for simple operation, or build a reviewed sequence for a specific time. Schedules, live content, school messages and promotions keep priority.</p>
    <div className={styles.autodjModeCards}>
      <button type="button" className={mode === "CONTINUOUS" ? styles.autodjModeActive : styles.autodjModeCard} onClick={() => setMode("CONTINUOUS")}><strong>Continuous AutoDJ</strong><span>Set up non-stop music</span><small>Ruvanas resumes automatically after a temporary live or scheduled block.</small></button>
      <button type="button" className={mode === "TIMED" ? styles.autodjModeActive : styles.autodjModeCard} onClick={() => setMode("TIMED")}><strong>Timed Playlist Generator</strong><span>Generate a timed playlist</span><small>Build and review a finite block such as 10:00–14:00.</small></button>
    </div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <div className={styles.formGrid}>
      <label><span>Target</span><select value={form.targetKey} onChange={(event) => setForm({ ...form, targetKey: event.target.value })}><option value="">Choose a target</option>{data.targets.map((target) => <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>{target.product} · {target.label}</option>)}</select></label>
      {mode === "CONTINUOUS" ? <><label><span>Status</span><select value={continuous.state} onChange={(event) => setContinuous({ ...continuous, state: event.target.value, enabled: event.target.value !== "DRAFT" })}><option value="ACTIVE">Active — play continuously</option><option value="PAUSED">Paused — keep settings</option><option value="DRAFT">Draft — not active</option></select></label><label><span>Primary music mode</span><select value={continuous.defaultMusicModeId} onChange={(event) => setContinuous({ ...continuous, defaultMusicModeId: event.target.value })}><option value="">Choose music</option>{playableModes.map((musicMode) => <option key={musicMode.id} value={musicMode.id}>{musicMode.name} · {musicMode.playableTrackCount} tracks</option>)}</select></label><label><span>Backup music mode</span><select value={continuous.backupMusicModeId} onChange={(event) => setContinuous({ ...continuous, backupMusicModeId: event.target.value })}><option value="">Use governed fallback</option>{playableModes.filter((musicMode) => musicMode.id !== continuous.defaultMusicModeId).map((musicMode) => <option key={musicMode.id} value={musicMode.id}>{musicMode.name}</option>)}</select></label></> : <><label><span>Playlist name</span><input value={timed.name} onChange={(event) => setTimed({ ...timed, name: event.target.value })} /></label><label><span>Date</span><input type="date" value={timed.scheduledDate} onChange={(event) => setTimed({ ...timed, scheduledDate: event.target.value })} /></label><label><span>Start and end</span><span className={styles.autodjTimePair}><input type="time" value={timed.startTime} onChange={(event) => setTimed({ ...timed, startTime: event.target.value })} /><input type="time" value={timed.endTime} onChange={(event) => setTimed({ ...timed, endTime: event.target.value })} /></span><small>{timedTarget?.timezone || "Target timezone"}</small></label></>}
    </div>
    <h3>Music sources</h3><ChoiceChips items={data.sourceScopes} values={form.sourceScopes} onChange={(values) => toggleScope(form, setForm, values)} />
    <div className={styles.autodjGenreHeader}><h3>Genres</h3><button type="button" className={styles.secondaryButton} onClick={() => setForm({ ...form, selectedGenreCodes: genreItems.filter((genre) => !licensedSelected(form) || genre.enabled).map((genre) => genre.code) })}>All available genres</button></div>
    <ChoiceChips items={genreItems} values={form.selectedGenreCodes} disabledFor={(genre) => licensedSelected(form) && !genre.enabled} onChange={(values) => setForm({ ...form, selectedGenreCodes: values })} />
    <div className={styles.actionBar}><span className={styles.safeClaim}>{mode === "CONTINUOUS" ? "No avoidable dead air while an eligible fallback exists." : "Generate → review → publish a frozen version"}</span>{mode === "CONTINUOUS" ? <button type="button" className={styles.primaryButton} disabled={busy || !continuous.defaultMusicModeId || !continuous.selectedGenreCodes.length} onClick={saveContinuous}>{busy ? "Saving…" : "Save Continuous AutoDJ"}</button> : <button type="button" className={styles.primaryButton} disabled={busy || !timed.selectedGenreCodes.length} onClick={generate}>{busy ? "Generating…" : "Generate and save draft"}</button>}</div>
    {version ? <div className={styles.smartPreview}><div className={styles.sectionHeading}><div><p className={styles.kicker}>TIMED PLAYLIST PREVIEW · VERSION {version.version}</p><h3>{version.items.length} tracks · {duration(version.generatedDurationSeconds)}</h3></div><span className={Math.abs(version.varianceSeconds) <= version.toleranceSeconds ? styles.permission : styles.draftBadge}>{version.varianceSeconds >= 0 ? "+" : ""}{version.varianceSeconds}s</span></div>
      {version.warnings.map((warning) => <div className={styles.compatibilityWarning} key={warning}>{warning}</div>)}
      <div className={styles.autodjPreviewTable}><div className={styles.autodjPreviewHead}><span>#</span><span>Start–end</span><span>Artist — title</span><span>Genre</span><span>Duration</span><span>Source</span></div>{version.items.map((item) => <div className={styles.autodjPreviewRow} key={item.id}><span>{item.position + 1}</span><span>{itemTime(preview, item.startOffsetSeconds)}–{itemTime(preview, item.endOffsetSeconds)}</span><strong>{item.artist} — {item.title}</strong><span>{item.genreCode.replaceAll("_", " ")}</span><span>{duration(item.durationSeconds)}</span><span>{item.sourceScope.replaceAll("_", " ")}</span></div>)}</div>
      <p className={styles.panelIntro}>Genre distribution: {Object.entries(version.genreDistribution).map(([genre, count]) => `${genre.replaceAll("_", " ")} ${count}`).join(" · ") || "No eligible music"}</p>
      <div className={styles.actionBar}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => action("regenerate")}>Regenerate new version</button><span className={styles.secondaryButton}>Draft saved</span>{data.canPublish ? <button type="button" className={styles.primaryButton} disabled={busy || !version.items.length} onClick={() => action("publish")}>Publish / schedule</button> : null}</div>
    </div> : null}
  </section>;
}
