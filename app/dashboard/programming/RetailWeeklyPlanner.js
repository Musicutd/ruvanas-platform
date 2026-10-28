"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RETAIL_PLANNER_STATION_ID, retailWeeklyEmptyItem, retailWeeklyForm, retailWeeklySaveBody,
  retailWeeklyFormSnapshot, retailWeeklyDays, retailWeeklySavedApproved, retailWeeklyDraftStatus,
  retailHalfHourChoices, retailProgrammeTimes, retailDurationToEnd, retailOneOffDateTime, retailPlaylistGenreSummary } from "@/lib/retail-weekly-planner-ui.mjs";
import { deskRecipeProgramme, mergeDeskRecipeSources } from "@/lib/retail-playlist-desk-ui.mjs";
import { testRadioPlannerWarnings as planningWarnings } from "@/lib/test-radio-planner-warnings.mjs";
import RetailPlaylistDesk from "./RetailPlaylistDesk";
import styles from "./retail-planner.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ENDPOINT = "/api/programming/test-retail/schedule";

export function RetailTimeSelect({ value, onChange, label }) {
  return <label>{label}<select required value={value} onChange={event => onChange(event.target.value)}>
    {!value && <option value="">Choose time</option>}
    {retailHalfHourChoices(value).map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
  </select></label>;
}

export function RetailWeeklyReview({ state }) {
  const [view, setView] = useState("cards"), days = retailWeeklyDays(state);
  const sourceName = id => state.sources?.find(source => source.id === id)?.name || "Saved playlist";
  if (!days.length) return <p role="alert">The saved weekly preview is unavailable. Refresh and review the saved draft.</p>;
  return <section aria-labelledby="retail-weekly-review-title" className={styles.review}>
    <h3 id="retail-weekly-review-title">Review saved version {state.draft.version}</h3>
    <p><strong>{state.schedule.name} · {state.schedule.timezone}</strong></p>
    <p>{retailWeeklySavedApproved(state) ? "This saved version has administrator approval. New edits need separate approval." : "An administrator must review and approve this saved draft before its programmes can go on air."} This preview is not proof of live audio. Saving here leaves the current stream unchanged.</p>
    <p className={styles.hint}>The cards show the next seven days. Later one-off programmes remain in your saved plan.</p>
    {(state.draft.preview.warnings || []).map((warning, index) => <p role="note" key={index} className={styles.notice}>{warning}</p>)}
    <div className={styles.toolbar} role="group" aria-label="Saved week view"><button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>Week cards</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>Agenda list</button></div>
    <div className={view === "cards" ? styles.weekCards : styles.formStack}>{days.map(day => <section key={day.date} className={styles.dayCard}>
      <h4>{day.label}</h4>{day.items.length ? <ol>{day.items.map((item, index) => <li key={`${item.sourceId}:${item.startsAt}:${index}`}><strong>{item.startLabel}–{item.endLabel}</strong> · {item.label}<br />{sourceName(item.sourceId)} · overlap priority {item.priority}</li>)}</ol> : <p>No scheduled programme. Automatic music can fill this time when Retail streaming is enabled.</p>}
    </section>)}</div>
  </section>;
}

export default function RetailWeeklyPlanner({ stationId, view = "all", onShowPlanner, onShowPlaylists }) {
  const [state, setState] = useState(null), [form, setForm] = useState(() => retailWeeklyForm(null));
  const [baseline, setBaseline] = useState(() => retailWeeklyFormSnapshot(retailWeeklyForm(null)));
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false), [selectedIndex, setSelectedIndex] = useState(0), [focusRequest, setFocusRequest] = useState(0);
  const programmeTiming = useRef(null), sequence = useRef(0), abortRead = useRef(null), actionPending = useRef(false), saveAttempt = useRef(null);
  const unsaved = retailWeeklyFormSnapshot(form) !== baseline, draftStatus = retailWeeklyDraftStatus(state, unsaved);
  const adopt = useCallback((body, channelId = "") => {
    if (body.stationId !== RETAIL_PLANNER_STATION_ID) throw new Error("The saved plan did not match Test Retail. Refresh before editing.");
    const next = retailWeeklyForm(body, channelId);
    saveAttempt.current = null; setState(body); setForm(next); setBaseline(retailWeeklyFormSnapshot(next)); setReviewOpen(false); setSelectedIndex(0);
  }, []);
  const load = useCallback(async (channelId = "") => {
    if (stationId !== RETAIL_PLANNER_STATION_ID || actionPending.current) return;
    const read = ++sequence.current; abortRead.current?.abort();
    const controller = new AbortController(); abortRead.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000); setBusy("load"); setError("");
    try {
      const response = await fetch(`${ENDPOINT}${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The Retail weekly plan could not be loaded.");
      if (read === sequence.current) adopt(body, channelId);
    } catch (caught) { if (read === sequence.current) { setError(caught.name === "AbortError" ? "Loading timed out. Refresh the saved plan before editing." : caught.message); setReviewOpen(false); } }
    finally { clearTimeout(timeout); if (read === sequence.current) setBusy(""); }
  }, [stationId, adopt]);
  useEffect(() => { void load(); return () => { sequence.current += 1; abortRead.current?.abort(); }; }, [load]);
  useEffect(() => { if (focusRequest) { programmeTiming.current?.scrollIntoView({ block: "center", behavior: "auto" }); programmeTiming.current?.focus({ preventScroll: true }); } }, [focusRequest]);
  useEffect(() => { if (!unsaved) return; const warn = event => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [unsaved]);

  async function saveDraft(event) {
    event?.preventDefault();
    if (actionPending.current || stationId !== RETAIL_PLANNER_STATION_ID || state?.canEdit !== true) return;
    let request;
    try {
      const snapshot = retailWeeklyFormSnapshot(form), baseVersionId = state?.draft?.id || null;
      request = retailWeeklySaveBody(form);
      if (!saveAttempt.current || saveAttempt.current.snapshot !== snapshot || saveAttempt.current.baseVersionId !== baseVersionId)
        saveAttempt.current = { snapshot, baseVersionId, requestId: crypto.randomUUID() };
      request = { ...request, requestId: saveAttempt.current.requestId, baseVersionId };
    } catch (caught) { setError(caught.message); return; }
    actionPending.current = true; sequence.current += 1; abortRead.current?.abort(); setBusy("save"); setError(""); setMessage(""); setReviewOpen(false);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(request) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The draft save could not be confirmed.");
      if (body.stationId !== RETAIL_PLANNER_STATION_ID || !body.savedVersionId || body.savedVersionId !== body.draft?.id)
        throw new Error("The save result is uncertain. Retry Save without changes to recover the same draft, or refresh the saved plan.");
      adopt(body, form.channelId); setMessage("Draft saved for administrator review. Review your saved week below; no on-air change was made.");
    } catch (caught) { setError(caught.name === "AbortError" ? "Saving timed out and its result is uncertain. Retry Save without changes to recover the same draft, or refresh the saved plan." : caught.message); }
    finally { clearTimeout(timeout); actionPending.current = false; setBusy(""); }
  }
  function changeItem(index, key, value) { setReviewOpen(false); setMessage(""); setForm(previous => ({ ...previous, items: previous.items.map((item, position) => position === index ? { ...item, [key]: value } : item) })); }
  function refresh(channelId = form.channelId) { if (unsaved && !window.confirm("Discard these unsaved planner changes and reload the saved version?")) return; setMessage(""); setReviewOpen(false); void load(channelId); }
  const updateRecipeSources = useCallback(recipes => setState(previous => mergeDeskRecipeSources(previous, recipes)), []);
  function addRecipeToWeek(recipe) {
    const item = deskRecipeProgramme(recipe); if (!item || state?.canEdit !== true || busy || form.items.length >= 200) return;
    const replaceEmpty = form.items.length === 1 && !form.items[0].sourceId;
    setState(previous => mergeDeskRecipeSources(previous, [recipe])); setSelectedIndex(replaceEmpty ? 0 : form.items.length);
    setForm(previous => ({ ...previous, items: replaceEmpty ? [item] : [...previous.items, item] })); setReviewOpen(false); setError("");
    setMessage(`Added “${recipe.name}” to your unsaved week. Choose its day and time, then save.`); onShowPlanner?.(); setFocusRequest(value => value + 1);
  }
  const editIndex = Math.min(selectedIndex, Math.max(0, form.items.length - 1)), item = form.items[editIndex];
  const programmeTimes = retailProgrammeTimes(item), selectedPlaylist = state?.sources?.find(source => source.id === item?.sourceId);
  const playlistName = id => state?.sources?.find(source => source.id === id)?.name || "Choose saved playlist";
  const warnings = state ? planningWarnings(form, state.sources).filter(warning => warning.code !== "DRAFT_REVIEW_HORIZON") : [];
  if (stationId !== RETAIL_PLANNER_STATION_ID) return null;
  return <section aria-labelledby="retail-weekly-title" className={styles.workspace}>
    <header className={styles.header}><p className={styles.eyebrow}>RETAIL · SUBSCRIBER PLANNING</p><div className={styles.headline}><h2 id="retail-weekly-title">One music plan for all your shops</h2><span className={styles.pill}>Drafts for administrator approval</span></div><p>Build a playlist, place it in your week, then save your draft. This workspace does not start music or change the current stream.</p></header>
    <div className={styles.guide}><span><b>1</b> Build or load a playlist</span><span><b>2</b> Choose its day and time</span><span><b>3</b> Save → administrator review</span></div>
    <div className={styles.body}>
      <div id="workspace-simple" hidden={view === "schedule"}><RetailPlaylistDesk stationId={stationId} onSourcesChanged={updateRecipeSources} onAddToWeek={addRecipeToWeek} canAddToWeek={state?.canEdit === true && !busy && form.items.length < 200} /></div>
      <section id="workspace-planner" hidden={view === "playlists"} className={styles.weekSection} aria-labelledby="retail-weekly-editor-title">
        <div className={styles.toolbar}><h3 id="retail-weekly-editor-title">Your weekly programmes</h3><span className={styles.tag}>{form.timezone}</span>{view === "schedule" && onShowPlaylists && <button type="button" onClick={onShowPlaylists}>Choose genres / build playlist</button>}<button type="button" disabled={Boolean(busy)} onClick={() => refresh()}>Refresh saved plan</button></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}{!state && !error && <p role="status">Loading your Retail plans and playlists…</p>}
        {state && <>
          <div className={styles.approvalStrip} role="status"><div><strong>Live schedule status is managed separately by your administrator.</strong><small>Saved drafts stay separate from the approved programme. This is planning status, not a live audio report.</small></div><span className={styles.tag}>{draftStatus.label}</span></div>
          {(state.warnings || []).map((warning, index) => <p key={index} role="note" className={styles.notice}>{warning}</p>)}
          <form onSubmit={saveDraft}>
            <div className={styles.twoFields} style={{ marginBottom: 18 }}><label>Plan name<input required maxLength={120} readOnly={Boolean(state.schedule)} disabled={Boolean(busy) || !state.canEdit} value={form.name} onChange={event => { setReviewOpen(false); setForm({ ...form, name: event.target.value }); }} /></label><label>Shared Retail programme<select required disabled={Boolean(busy)} value={form.channelId} onChange={event => refresh(event.target.value)}><option value="">Choose programme</option>{(state.channels || []).map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label></div>
            <section className={styles.plannerChecks} aria-labelledby="retail-planner-checks"><h4 id="retail-planner-checks">Draft planning checks</h4><p className={styles.hint}>Checks cover the next 31 calendar days and currently available music. Administrator approval remains separate.</p>
              {warnings.length ? <ul>{warnings.map((warning, index) => <li key={`${warning.code}:${index}`} className={warning.severity === "BLOCKING" ? styles.error : styles.notice}><strong>{warning.severity === "BLOCKING" ? "Needs attention" : "Planning note"}</strong><p>{warning.message}</p>{(warning.itemIndexes || []).filter(position => form.items[position]).map(position => <button type="button" key={position} disabled={Boolean(busy)} onClick={() => { setSelectedIndex(position); setFocusRequest(value => value + 1); }}>Review programme {position + 1}</button>)}</li>)}</ul> : <p className={styles.hint}>No issues found by these draft checks. This is not approval or proof of audio.</p>}
            </section>
            <div className={styles.editLayout}>
              <section aria-label="Programme draft agenda"><p className={styles.sectionLabel}>Select a programme to edit</p><ol className={styles.agenda}>{form.items.map((programme, index) => <li key={index}><button type="button" aria-pressed={editIndex === index} disabled={Boolean(busy)} onClick={() => setSelectedIndex(index)} aria-label={`Edit programme ${index + 1}: ${programme.label}`}><span className={styles.agendaTime}>{programme.recurrence === "WEEKLY" ? programme.startTime || "--:--" : programme.startsAt?.slice(11) || "--:--"}<small>{programme.recurrence === "WEEKLY" ? DAYS[programme.weekday]?.slice(0, 3) : programme.startsAt?.slice(0, 10) || "One time"}</small></span><span className={styles.agendaName}><strong>{programme.label}</strong><small>{playlistName(programme.sourceId)} · {programme.durationMinutes || "—"} min</small></span><span className={styles.meta}>{programme.recurrence === "WEEKLY" ? "Weekly" : "One-off"}</span></button></li>)}</ol>
                <button type="button" style={{ marginTop: 12 }} disabled={Boolean(busy) || !state.canEdit || form.items.length >= 200} onClick={() => { setReviewOpen(false); setSelectedIndex(form.items.length); setForm({ ...form, items: [...form.items, retailWeeklyEmptyItem()] }); }}>+ Add programme</button><p className={styles.hint}>These rows are your draft, not the live queue.</p>
              </section>
              <div className={styles.editor}><h3>Edit programme {editIndex + 1}</h3><fieldset disabled={Boolean(busy) || state.canEdit !== true}><div className={styles.formStack}>
                <label>Programme name<input required maxLength={160} value={item.label} onChange={event => changeItem(editIndex, "label", event.target.value)} /></label>
                <label>Music for this time<select required value={item.sourceId} onChange={event => changeItem(editIndex, "sourceId", event.target.value)}><option value="">Choose a saved genre mix</option>{(state.sources || []).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                {selectedPlaylist && <p className={styles.hint}><strong>Genres: {retailPlaylistGenreSummary(selectedPlaylist, state.genres)}</strong><br />Create another genre mix in Playlists to choose different music for this time.</p>}
                <div className={styles.twoFields}><label>Repeat<select value={item.recurrence} onChange={event => changeItem(editIndex, "recurrence", event.target.value)}><option value="WEEKLY">Every week</option><option value="ONE_OFF">One time only</option></select></label>
                  {item.recurrence === "WEEKLY" ? <label>Day<select ref={programmeTiming} value={item.weekday} onChange={event => changeItem(editIndex, "weekday", Number(event.target.value))}>{DAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label> : <label>Date<input ref={programmeTiming} required type="date" value={(item.startsAt || "").split("T")[0]} onChange={event => changeItem(editIndex, "startsAt", retailOneOffDateTime(item, { date: event.target.value }))} /></label>}
                </div>
                <div className={styles.twoFields}>
                  <RetailTimeSelect label="Start time" value={programmeTimes.startTime} onChange={value => changeItem(editIndex, item.recurrence === "WEEKLY" ? "startTime" : "startsAt", item.recurrence === "WEEKLY" ? value : retailOneOffDateTime(item, { time: value }))} />
                  <RetailTimeSelect label="End time" value={programmeTimes.endTime} onChange={value => changeItem(editIndex, "durationMinutes", retailDurationToEnd(programmeTimes.startTime, value))} />
                </div>
                <p className={styles.hint} role="status">{programmeTimes.durationMinutes !== null ? `${programmeTimes.startTime}–${programmeTimes.endTime}${programmeTimes.nextDay ? " the next day" : ""} · ${programmeTimes.durationMinutes} minutes.` : "Choose a valid programme length."} Half-hour choices keep timing simple; existing precise times are preserved. An end time at or before the start finishes the next day.</p>
                <p className={styles.hint}>Times use {form.timezone}. After approval, a programme starts at its scheduled time and random AutoDJ fills unscheduled time. Review the saved week for exact dates, overlaps and clock changes.</p>
              </div><details className={styles.disclosure}><summary>Advanced: precise length and overlap priority</summary><label>Length in minutes<input required type="number" min="1" max="1440" value={item.durationMinutes} onChange={event => changeItem(editIndex, "durationMinutes", event.target.value)} /></label><p>Length is elapsed minutes. On a clock-change day, review the saved week for the actual local end time.</p><p>A higher number wins during overlaps. Equal-priority overlaps need correction before approval.</p><label>Priority<input type="number" min="0" max="100" value={item.priority} onChange={event => changeItem(editIndex, "priority", event.target.value)} /></label></details><button type="button" className={styles.quiet} disabled={form.items.length === 1} onClick={() => { setReviewOpen(false); setForm({ ...form, items: form.items.filter((_, position) => position !== editIndex) }); setSelectedIndex(Math.max(0, editIndex - 1)); }}>Remove programme</button></fieldset></div>
            </div>
            {!state.canEdit && <p role="note" className={styles.notice}>Editing is unavailable. Your administrator can check the planning channel and catalogue permission.</p>}
            <div className={styles.weekActions}><p role="status">{draftStatus.detail}</p><button type="submit" className={styles.primary} disabled={Boolean(busy) || !state.canEdit || !form.channelId || !state.sources?.length}>{busy === "save" ? "Saving…" : "Save draft — no on-air change"}</button><button type="button" disabled={Boolean(busy) || unsaved || Boolean(error) || !state.draft?.preview} onClick={() => setReviewOpen(true)}>Review saved week</button></div>
          </form>
        </>}
        {reviewOpen && state?.draft && <RetailWeeklyReview state={state} />}
      </section>
      <details className={styles.disclosure} hidden={view === "playlists"}><summary>How draft scheduling works</summary><p><strong>Save draft → review saved week → ask your administrator to approve.</strong> Saving and previewing do not change the on-air version. Streaming and on-air approval remain administrator-only.</p><label>Planner time zone<input value={form.timezone} readOnly={Boolean(state?.schedule)} disabled={Boolean(busy) || !state?.canEdit} onChange={event => { setReviewOpen(false); setForm({ ...form, timezone: event.target.value }); }} /></label><p>The time zone is fixed after the first save. Clock-change ambiguities must be reviewed.</p></details>
    </div>
  </section>;
}
